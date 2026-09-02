import { prisma } from '../prisma';
import { notFound } from '../errors';
import { PullRequestStatus, Prisma } from '../generated/prisma/client';
import { decryptToken } from '../github/utils/github-token-crypto';
import {
  GitHubClient,
  GitHubClientError,
  generateBranchName,
  resolveUniqueBranchName,
  generateCommitMessage,
  generatePullRequestContent,
  computePatchHash,
  verifyPatchIntegrity,
  runPrPromotion,
  type PrPromotionResult,
  type PrPromotionStage,
} from '@rootly.ai/github';

/** Structured, secret-free logging — never includes the GitHub token. */
function log(event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...fields }));
}

export class PrCreationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RegressionSummary {
  outcome?: string | null;
}
interface ValidationSummaryShape {
  regressionTests?: RegressionSummary;
}

async function loadPreconditionData(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  const precondition = 'A verified fix is required before creating a pull request.';

  const repository = await prisma.repository.findUnique({ where: { projectId: incident.projectId } });
  if (!repository) {
    throw new PrCreationError('PR_CREATION_PRECONDITION_FAILED', precondition);
  }

  const fixAttempt = await prisma.fixAttempt.findFirst({
    where: { incidentId, status: 'COMPLETED', result: 'FIX_VERIFIED' },
    orderBy: { createdAt: 'desc' },
    include: { patches: true },
  });
  if (!fixAttempt || !fixAttempt.patch || !fixAttempt.targetCommitSha || !fixAttempt.validatedPatchHash || fixAttempt.patches.length === 0) {
    throw new PrCreationError('PR_CREATION_PRECONDITION_FAILED', precondition);
  }

  // The trust boundary between Phase 7 (validation) and Phase 8 (promotion): the patch
  // being pushed must be byte-for-byte the one that was actually verified in a sandbox.
  if (!verifyPatchIntegrity(fixAttempt.patch, fixAttempt.validatedPatchHash)) {
    throw new PrCreationError('PATCH_INTEGRITY_FAILED', 'The verified patch no longer matches its recorded hash. Refusing to promote it.');
  }

  const investigation = await prisma.investigation.findUnique({ where: { id: fixAttempt.investigationId } });

  return { incident, repository, fixAttempt, investigation };
}

/**
 * Resolves preconditions, reserves a unique branch name (a handful of fast
 * GitHub calls, done synchronously so the DB's own (repositoryId, branchName)
 * uniqueness constraint and GitHub's real branch namespace can never
 * disagree), creates the PullRequest record, and kicks off the actual
 * checkout/commit/push pipeline in the background — mirroring the
 * fire-and-forget pattern used by investigations/reproductions/fix-attempts.
 */
export async function startPrCreation(incidentId: string, clientOverride?: GitHubClient): Promise<{ id: string; status: PullRequestStatus }> {
  if (process.env.PR_CREATION_ENABLED === 'false') {
    throw new PrCreationError('PR_CREATION_DISABLED', 'GitHub PR creation is disabled on this server.');
  }

  const { incident, repository, fixAttempt } = await loadPreconditionData(incidentId);

  const existing = await prisma.pullRequest.findFirst({
    where: { fixAttemptId: fixAttempt.id, status: { in: [PullRequestStatus.OPEN, PullRequestStatus.CREATING] } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    log('pr_creation_idempotent_reuse', { incidentId, fixAttemptId: fixAttempt.id, pullRequestId: existing.id });
    return { id: existing.id, status: existing.status };
  }

  const accessToken = decryptToken(repository.encryptedAccessToken);
  const client = clientOverride ?? new GitHubClient(accessToken);

  const candidate = generateBranchName(incident.sequenceNumber, fixAttempt.explanation ?? incident.errorName);
  const branchName = await resolveUniqueBranchName(client, repository.owner, repository.name, candidate);

  const investigation = await prisma.investigation.findUnique({ where: { id: fixAttempt.investigationId } });
  const validationSummary = fixAttempt.validationSummary as ValidationSummaryShape | null;
  const regressionTestsRan = validationSummary?.regressionTests?.outcome === 'PASSED';

  const prContent = generatePullRequestContent({
    incidentSequenceNumber: incident.sequenceNumber,
    errorName: incident.errorName,
    errorMessage: incident.errorMessage,
    rootCause: investigation?.summary ?? null,
    targetCommitSha: fixAttempt.targetCommitSha!,
    fixExplanation: fixAttempt.explanation,
    changedFiles: fixAttempt.changedFiles,
    regressionTestsRan,
  });

  const pullRequest = await prisma.pullRequest.create({
    data: {
      incidentId,
      fixAttemptId: fixAttempt.id,
      repositoryId: repository.id,
      branchName,
      baseBranch: repository.defaultBranch,
      title: prContent.title,
      body: prContent.body,
      status: PullRequestStatus.CREATING,
    },
  });

  log('pr_creation_started', { incidentId, fixAttemptId: fixAttempt.id, pullRequestId: pullRequest.id, branchName });

  void executePrCreation(pullRequest.id, client, accessToken).catch((err) => {
    log('pr_creation_unhandled_error', { pullRequestId: pullRequest.id, message: err instanceof Error ? err.message : String(err) });
  });

  return { id: pullRequest.id, status: pullRequest.status };
}

async function executePrCreation(pullRequestId: string, client: GitHubClient, accessToken: string): Promise<void> {
  const pullRequest = await prisma.pullRequest.findUniqueOrThrow({ where: { id: pullRequestId } });
  const [incident, repository, fixAttempt] = await Promise.all([
    prisma.incident.findUniqueOrThrow({ where: { id: pullRequest.incidentId } }),
    prisma.repository.findUniqueOrThrow({ where: { id: pullRequest.repositoryId } }),
    prisma.fixAttempt.findUniqueOrThrow({ where: { id: pullRequest.fixAttemptId }, include: { patches: true } }),
  ]);

  try {
    const commitMessage = generateCommitMessage({
      incidentSequenceNumber: incident.sequenceNumber,
      errorName: incident.errorName,
      fixSummary: fixAttempt.explanation,
    });

    const result: PrPromotionResult = await runPrPromotion(
      {
        owner: repository.owner,
        repo: repository.name,
        repositoryUrl: repository.repositoryUrl,
        accessToken,
        defaultBranch: repository.defaultBranch,
        targetCommitSha: fixAttempt.targetCommitSha!,
        branchName: pullRequest.branchName,
        patches: fixAttempt.patches.map((p) => ({ filePath: p.filePath, originalContent: p.originalContent, patchedContent: p.patchedContent, diff: p.diff })),
        commitMessage: commitMessage.full,
        prTitle: pullRequest.title,
        prBody: pullRequest.body,
      },
      {
        client,
        onStage: (stage: PrPromotionStage) => {
          log('pr_creation_stage', { pullRequestId, stage });
        },
      },
    );

    if (result.status === 'CREATED') {
      await prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: {
          status: PullRequestStatus.OPEN,
          commitSha: result.commitSha,
          prNumber: result.prNumber,
          prUrl: result.prUrl,
        },
      });
      log('pr_creation_completed', { pullRequestId, status: 'OPEN', prNumber: result.prNumber });
    } else {
      await prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: { status: PullRequestStatus.FAILED, errorMessage: `${result.errorCode}: ${result.errorMessage}` },
      });
      log('pr_creation_completed', { pullRequestId, status: 'FAILED', errorCode: result.errorCode });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected PR creation failure';
    await prisma.pullRequest.update({
      where: { id: pullRequestId },
      data: { status: PullRequestStatus.FAILED, errorMessage: message },
    });
    log('pr_creation_completed', { pullRequestId, status: 'FAILED', errorMessage: message });
  }
}

const PULL_REQUEST_SELECT = {
  id: true,
  incidentId: true,
  fixAttemptId: true,
  repositoryId: true,
  branchName: true,
  baseBranch: true,
  commitSha: true,
  prNumber: true,
  prUrl: true,
  title: true,
  body: true,
  status: true,
  errorMessage: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PullRequestSelect;

export async function getPullRequest(id: string) {
  const pullRequest = await prisma.pullRequest.findUnique({ where: { id }, select: PULL_REQUEST_SELECT });
  if (!pullRequest) throw notFound('Pull request not found');
  return pullRequest;
}

export async function listIncidentPullRequests(incidentId: string) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  return prisma.pullRequest.findMany({
    where: { incidentId },
    orderBy: { createdAt: 'desc' },
    select: PULL_REQUEST_SELECT,
  });
}

/** Queries GitHub for the PR's current state and updates the local row — never merges, never approves. */
export async function refreshPullRequest(id: string, clientOverride?: GitHubClient) {
  const pullRequest = await prisma.pullRequest.findUnique({ where: { id } });
  if (!pullRequest) throw notFound('Pull request not found');
  if (pullRequest.prNumber == null) return getPullRequest(id);

  const repository = await prisma.repository.findUniqueOrThrow({ where: { id: pullRequest.repositoryId } });
  const client = clientOverride ?? new GitHubClient(decryptToken(repository.encryptedAccessToken));

  try {
    const remote = await client.getPullRequest(repository.owner, repository.name, pullRequest.prNumber);
    const status = remote.merged ? PullRequestStatus.MERGED : remote.state === 'closed' ? PullRequestStatus.CLOSED : PullRequestStatus.OPEN;
    await prisma.pullRequest.update({ where: { id }, data: { status } });
  } catch (err) {
    if (err instanceof GitHubClientError && err.code === 'RATE_LIMITED') {
      log('pr_refresh_rate_limited', { pullRequestId: id });
    } else {
      log('pr_refresh_failed', { pullRequestId: id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return getPullRequest(id);
}
