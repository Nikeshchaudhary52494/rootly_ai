import { prisma } from '../prisma';
import { badRequest, notFound } from '../errors';
import { IncidentCodeContextStatus, RepositoryFileType } from '../generated/prisma/client';
import { decryptToken } from '../github/utils/github-token-crypto';
import { parseStackTrace } from '../github/utils/stack-trace-parser';
import { matchSourceFile } from '../github/utils/source-file-matcher';
import * as github from '../github/github.service';
import { extractCodeWindow } from './utils/code-window';
import { findRelatedTestPaths } from './utils/related-tests';

const RECENT_COMMITS_LIMIT = 10;

interface CollectResult {
  id: string;
  status: IncidentCodeContextStatus;
}

async function markFailed(contextId: string, summary: string): Promise<CollectResult> {
  await prisma.incidentCodeContext.update({
    where: { id: contextId },
    data: { status: IncidentCodeContextStatus.FAILED, summary },
  });
  return { id: contextId, status: IncidentCodeContextStatus.FAILED };
}

/**
 * Incident ID -> latest ErrorEvent -> project's repository -> parse stack ->
 * match against the synced repository tree -> fetch the primary file's code
 * window, related tests, and recent commits -> store as IncidentCodeContext.
 * Structured as one pass so it can move behind a queue later without
 * reshaping the pipeline itself.
 */
export async function collectContext(incidentId: string): Promise<CollectResult> {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw notFound('Incident not found');

  const latestEvent = await prisma.errorEvent.findUnique({ where: { id: incident.latestEventId } });
  if (!latestEvent) throw notFound('Latest event for this incident was not found');

  const repository = await prisma.repository.findUnique({ where: { projectId: incident.projectId } });
  if (!repository) throw badRequest('No repository connected for this project');

  const context = await prisma.incidentCodeContext.upsert({
    where: { incidentId },
    create: {
      incidentId,
      repositoryId: repository.id,
      status: IncidentCodeContextStatus.COLLECTING,
      errorMessage: latestEvent.errorMessage,
    },
    update: {
      repositoryId: repository.id,
      status: IncidentCodeContextStatus.COLLECTING,
      errorMessage: latestEvent.errorMessage,
      primaryFilePath: null,
      primaryLineNumber: null,
      summary: null,
      generatedAt: null,
    },
  });

  await prisma.$transaction([
    prisma.incidentCodeFile.deleteMany({ where: { incidentCodeContextId: context.id } }),
    prisma.incidentCodeCommit.deleteMany({ where: { incidentCodeContextId: context.id } }),
  ]);

  let accessToken: string;
  try {
    accessToken = decryptToken(repository.encryptedAccessToken);
  } catch {
    return markFailed(context.id, 'Stored repository credentials could not be decrypted.');
  }

  const repoFiles = await prisma.repositoryFile.findMany({
    where: { repositoryId: repository.id, type: RepositoryFileType.FILE },
    select: { path: true },
  });
  const repoPaths = repoFiles.map((f) => f.path);

  if (repoPaths.length === 0) {
    return markFailed(context.id, 'Repository has not been synced yet. Run a sync before collecting context.');
  }

  const { frames } = parseStackTrace(latestEvent.stackTrace ?? undefined);

  // Find the first stack frame that resolves to a real file in the repo —
  // an unmatched frame (e.g. a node_modules path) is skipped, not fatal.
  let primaryMatch: { path: string; line: number; column: number | null; functionName: string | null } | null = null;
  for (const frame of frames) {
    const matchedPath = matchSourceFile(frame.filePath, repoPaths);
    if (!matchedPath) continue;
    primaryMatch = { path: matchedPath, line: frame.line ?? 1, column: frame.column, functionName: frame.functionName };
    break;
  }

  if (!primaryMatch) {
    return markFailed(context.id, 'No stack frame could be matched to a file in the connected repository.');
  }

  let primaryContent: string;
  try {
    primaryContent = await github.getFileContent(
      accessToken,
      repository.owner,
      repository.name,
      primaryMatch.path,
      repository.defaultBranch,
    );
  } catch (err) {
    return markFailed(context.id, err instanceof Error ? err.message : 'Unable to fetch source file from GitHub.');
  }

  const window = extractCodeWindow(primaryContent, primaryMatch.line);

  interface FileRecord {
    incidentCodeContextId: string;
    filePath: string;
    lineNumber: number | null;
    columnNumber: number | null;
    functionName: string | null;
    content: string;
    contentStartLine: number;
    contentEndLine: number;
    isPrimary: boolean;
  }

  const fileRecords: FileRecord[] = [
    {
      incidentCodeContextId: context.id,
      filePath: primaryMatch.path,
      lineNumber: primaryMatch.line,
      columnNumber: primaryMatch.column,
      functionName: primaryMatch.functionName,
      content: window.content,
      contentStartLine: window.contentStartLine,
      contentEndLine: window.contentEndLine,
      isPrimary: true,
    },
  ];

  const relatedTestPaths = findRelatedTestPaths(primaryMatch.path, repoPaths);
  for (const testPath of relatedTestPaths) {
    try {
      const testContent = await github.getFileContent(
        accessToken,
        repository.owner,
        repository.name,
        testPath,
        repository.defaultBranch,
      );
      const testLines = testContent.split('\n');
      fileRecords.push({
        incidentCodeContextId: context.id,
        filePath: testPath,
        lineNumber: null,
        columnNumber: null,
        functionName: null,
        content: testContent,
        contentStartLine: 1,
        contentEndLine: testLines.length,
        isPrimary: false,
      });
    } catch {
      // A related test we can't read shouldn't sink the whole collection.
    }
  }

  let commits: Awaited<ReturnType<typeof github.getCommitsForFile>> = [];
  try {
    commits = await github.getCommitsForFile(
      accessToken,
      repository.owner,
      repository.name,
      primaryMatch.path,
      repository.defaultBranch,
      RECENT_COMMITS_LIMIT,
    );
  } catch {
    commits = [];
  }

  await prisma.$transaction([
    prisma.incidentCodeContext.update({
      where: { id: context.id },
      data: {
        status: IncidentCodeContextStatus.READY,
        generatedAt: new Date(),
        primaryFilePath: primaryMatch.path,
        primaryLineNumber: primaryMatch.line,
        summary: 'Collected code context from stack trace and repository.',
      },
    }),
    prisma.incidentCodeFile.createMany({ data: fileRecords }),
    ...(commits.length
      ? [
          prisma.incidentCodeCommit.createMany({
            data: commits.map((commit) => ({
              incidentCodeContextId: context.id,
              sha: commit.sha,
              message: commit.message,
              authorName: commit.authorName,
              authorEmail: commit.authorEmail,
              committedAt: new Date(commit.committedAt),
              filePath: primaryMatch!.path,
            })),
          }),
        ]
      : []),
  ]);

  return { id: context.id, status: IncidentCodeContextStatus.READY };
}

export async function getContext(incidentId: string) {
  const context = await prisma.incidentCodeContext.findUnique({
    where: { incidentId },
    include: { files: true, commits: { orderBy: { committedAt: 'desc' } } },
  });
  if (!context) throw notFound('No code context has been collected for this incident yet');

  return {
    id: context.id,
    status: context.status,
    summary: context.summary,
    primaryLocation: context.primaryFilePath
      ? { filePath: context.primaryFilePath, lineNumber: context.primaryLineNumber }
      : null,
    files: context.files
      .filter((f) => f.isPrimary)
      .map((f) => ({
        filePath: f.filePath,
        functionName: f.functionName,
        lineNumber: f.lineNumber,
        columnNumber: f.columnNumber,
        contentStartLine: f.contentStartLine,
        contentEndLine: f.contentEndLine,
        content: f.content,
        isPrimary: f.isPrimary,
      })),
    relatedTests: context.files
      .filter((f) => !f.isPrimary)
      .map((f) => ({ filePath: f.filePath, content: f.content })),
    recentCommits: context.commits.map((c) => ({
      sha: c.sha,
      message: c.message,
      authorName: c.authorName,
      authorEmail: c.authorEmail,
      committedAt: c.committedAt,
    })),
  };
}
