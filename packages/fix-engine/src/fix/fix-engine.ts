import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { InvestigationLLM } from '@rootly.ai/agent';
import { checkoutRepository, type CheckoutResult, type SandboxConfig } from '@rootly.ai/reproduction';
import { createFixSandbox, loadFixSandboxConfig } from '../sandbox/fix-sandbox';
import { buildPostFixValidationCommand, buildReproductionCheckCommand, buildRegressionCommand } from '../sandbox/sandbox-runner';
import { generateFixProposal } from '../patch/patch-generator';
import { generatePostFixValidationTest } from '../patch/post-fix-test-generator';
import { verifyOriginalContent, DEFAULT_PATCH_SAFETY_LIMITS, type PatchSafetyLimits } from '../patch/patch-validator';
import { applyChangesToFile, renderUnifiedDiff } from '../patch/patch-parser';
import { evaluateBeforeFixReproduction, evaluatePostFixValidation } from '../validation/reproduction-validator';
import { evaluateRegressionResult, skippedRegressionResult } from '../validation/regression-validator';
import { classifyFix, type FixClassification } from '../validation/fix-classifier';
import type { FixGenerationInput } from '../graph/fix-generation.state';
import type { FixProposal } from '../schemas/fix-proposal.schema';

export type FixEngineStage =
  | 'GENERATING_FIX'
  | 'VALIDATING_PATCH'
  | 'CREATING_SANDBOX'
  | 'CHECKING_OUT'
  | 'APPLYING_PATCH'
  | 'RUNNING_REPRODUCTION'
  | 'RUNNING_REGRESSION_TESTS'
  | 'VALIDATING';

export interface FixEngineInput {
  targetCommitSha: string;
  repositoryUrl: string;
  /** Decrypted token for a private repo only — never persisted, logged, or shown to the model. */
  accessToken?: string;
  fixGenerationInput: FixGenerationInput;
}

export interface FixEngineOptions {
  llm: InvestigationLLM;
  sandboxConfig?: SandboxConfig;
  patchLimits?: PatchSafetyLimits;
  onStage?: (stage: FixEngineStage) => void | Promise<void>;
}

export interface FixPatchRecord {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
}

export interface ValidationSummary {
  patchApplied: boolean;
  reproductionBeforeFix: { result: string | null; reason: string | null };
  postFixValidation: { outcome: string | null; reason: string | null };
  regressionTests: { outcome: string | null; total: number; failed: number; reason: string | null };
  result: FixClassification;
}

export interface FixEngineResult {
  /** COMPLETED means the pipeline ran to some conclusion (possibly INCONCLUSIVE/REJECTED); FAILED means the pipeline itself broke. */
  status: 'COMPLETED' | 'FAILED';
  result: FixClassification | null;
  targetCommitSha: string;
  proposal: FixProposal | null;
  patches: FixPatchRecord[];
  validationSummary: ValidationSummary | null;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
}

function completedResult(partial: Partial<FixEngineResult> & { targetCommitSha: string }): FixEngineResult {
  return {
    status: 'COMPLETED',
    result: null,
    proposal: null,
    patches: [],
    validationSummary: null,
    stdout: '',
    stderr: '',
    errorMessage: null,
    ...partial,
  };
}

function failedResult(
  errorMessage: string,
  targetCommitSha: string,
  proposal: FixProposal | null = null,
  patches: FixPatchRecord[] = [],
): FixEngineResult {
  return {
    status: 'FAILED',
    result: null,
    targetCommitSha,
    proposal,
    patches,
    validationSummary: null,
    stdout: '',
    stderr: '',
    errorMessage,
  };
}

function groupByFile<T extends { filePath: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.filePath) ?? [];
    list.push(item);
    map.set(item.filePath, list);
  }
  return map;
}

/**
 * GENERATE_FIX -> CHECK_OUT -> CREATE_SANDBOX -> confirm BEFORE-fix
 * reproduction -> APPLY_PATCH -> generate + run AFTER-fix validation ->
 * RUN_REGRESSION -> CLASSIFY, always destroying the sandbox and host
 * checkout in `finally`.
 *
 * The same FAILED-vs-COMPLETED distinction as the reproduction engine:
 * FAILED is reserved for the system breaking (no proposal could be
 * generated, or Docker itself couldn't create a container). Everything that
 * gets as far as attempting validation resolves to status COMPLETED with a
 * result of FIX_VERIFIED / FIX_REJECTED / INCONCLUSIVE.
 */
export async function runFixAttempt(input: FixEngineInput, options: FixEngineOptions): Promise<FixEngineResult> {
  const config = options.sandboxConfig ?? loadFixSandboxConfig();
  const limits = options.patchLimits ?? DEFAULT_PATCH_SAFETY_LIMITS;
  const emit = async (stage: FixEngineStage) => {
    await options.onStage?.(stage);
  };

  await emit('GENERATING_FIX');
  const generation = await generateFixProposal(input.fixGenerationInput, { llm: options.llm, limits });
  if (generation.status !== 'COMPLETED' || !generation.proposal) {
    return failedResult(generation.errors.join(' | ') || 'FIX_GENERATION_FAILED: no proposal was produced.', input.targetCommitSha);
  }
  const proposal = generation.proposal;
  await emit('VALIDATING_PATCH'); // already validated during generation (safety + cached-content match); this marks the stage for observers

  const sandbox = createFixSandbox(config);
  let checkout: CheckoutResult | null = null;
  let stage: 'checkout' | 'later' = 'checkout';
  const patches: FixPatchRecord[] = [];
  const stdoutParts: string[] = [];
  const stderrParts: string[] = [];

  try {
    await emit('CHECKING_OUT');
    checkout = await checkoutRepository({
      repositoryUrl: input.repositoryUrl,
      commitSha: input.targetCommitSha,
      accessToken: input.accessToken,
      timeoutMs: config.timeoutMs,
    });

    const reproTestPath = join(checkout.workspacePath, input.fixGenerationInput.reproduction.testFilePath);
    await mkdir(dirname(reproTestPath), { recursive: true });
    await writeFile(reproTestPath, input.fixGenerationInput.reproduction.generatedTest, 'utf8');

    stage = 'later';
    await emit('CREATING_SANDBOX');
    await sandbox.create();
    await sandbox.copyIn(checkout.workspacePath);

    await emit('RUNNING_REPRODUCTION');
    const beforeRun = await sandbox.run(buildReproductionCheckCommand(input.fixGenerationInput.reproduction.testFilePath));
    const beforeFix = evaluateBeforeFixReproduction(beforeRun);
    stdoutParts.push(`--- before-fix reproduction ---\n${beforeRun.stdout}`);
    stderrParts.push(`--- before-fix reproduction ---\n${beforeRun.stderr}`);

    if (beforeFix.result !== 'REPRODUCED') {
      const classification = classifyFix({
        patchApplied: false,
        beforeFixResult: beforeFix.result,
        postFixOutcome: null,
        regressionOutcome: null,
      });
      return completedResult({
        targetCommitSha: checkout.resolvedCommitSha,
        proposal,
        result: classification.result,
        stdout: stdoutParts.join('\n\n'),
        stderr: stderrParts.join('\n\n'),
        errorMessage: classification.reason,
        validationSummary: {
          patchApplied: false,
          reproductionBeforeFix: { result: beforeFix.result, reason: beforeFix.reason },
          postFixValidation: { outcome: null, reason: null },
          regressionTests: { outcome: null, total: 0, failed: 0, reason: null },
          result: classification.result,
        },
      });
    }

    await emit('APPLYING_PATCH');
    const changesByFile = groupByFile(proposal.changes);
    let patchError: string | null = null;

    for (const [filePath, changes] of changesByFile) {
      const absPath = join(checkout.workspacePath, filePath);
      let originalContent: string;
      try {
        originalContent = await readFile(absPath, 'utf8');
      } catch {
        patchError = `${filePath}: file does not exist in the checked-out repository`;
        break;
      }

      const mismatch = changes.find((change) => !verifyOriginalContent(originalContent, change));
      if (mismatch) {
        patchError = `${filePath}: original code does not match the real repository content at lines ${mismatch.startLine}-${mismatch.endLine}`;
        break;
      }

      const patchedContent = applyChangesToFile(originalContent, changes);
      await writeFile(absPath, patchedContent, 'utf8');
      patches.push({ filePath, originalContent, patchedContent, diff: renderUnifiedDiff(filePath, originalContent, patchedContent) });
    }

    if (patchError) {
      const classification = classifyFix({
        patchApplied: false,
        beforeFixResult: beforeFix.result,
        postFixOutcome: null,
        regressionOutcome: null,
      });
      return completedResult({
        targetCommitSha: checkout.resolvedCommitSha,
        proposal,
        patches,
        result: classification.result,
        stdout: stdoutParts.join('\n\n'),
        stderr: stderrParts.join('\n\n'),
        errorMessage: patchError,
        validationSummary: {
          patchApplied: false,
          reproductionBeforeFix: { result: beforeFix.result, reason: beforeFix.reason },
          postFixValidation: { outcome: null, reason: null },
          regressionTests: { outcome: null, total: 0, failed: 0, reason: null },
          result: classification.result,
        },
      });
    }

    // Patched files now live on the host checkout; copy them into the still-running container, overwriting the pre-patch copies.
    await sandbox.copyIn(checkout.workspacePath);

    const postFixTestGen = await generatePostFixValidationTest(input.fixGenerationInput, proposal, { llm: options.llm });
    if (postFixTestGen.status !== 'COMPLETED' || !postFixTestGen.test) {
      return failedResult(
        postFixTestGen.errors.join(' | ') || 'Post-fix validation test generation failed.',
        checkout.resolvedCommitSha,
        proposal,
        patches,
      );
    }

    const postFixTestAbsPath = join(checkout.workspacePath, postFixTestGen.test.filePath);
    await mkdir(dirname(postFixTestAbsPath), { recursive: true });
    await writeFile(postFixTestAbsPath, postFixTestGen.test.content, 'utf8');
    await sandbox.copyIn(checkout.workspacePath);

    await emit('RUNNING_REPRODUCTION');
    const afterRun = await sandbox.run(buildPostFixValidationCommand(postFixTestGen.test.filePath));
    const postFix = evaluatePostFixValidation(afterRun);
    stdoutParts.push(`--- post-fix validation ---\n${afterRun.stdout}`);
    stderrParts.push(`--- post-fix validation ---\n${afterRun.stderr}`);

    await emit('RUNNING_REGRESSION_TESTS');
    const regressionPaths = input.fixGenerationInput.codeContext.relatedTests.map((t) => t.filePath);
    const regression = regressionPaths.length
      ? await (async () => {
          const regressionRun = await sandbox.run(buildRegressionCommand(regressionPaths));
          stdoutParts.push(`--- regression tests ---\n${regressionRun.stdout}`);
          stderrParts.push(`--- regression tests ---\n${regressionRun.stderr}`);
          return evaluateRegressionResult(regressionRun);
        })()
      : skippedRegressionResult();

    await emit('VALIDATING');
    const classification = classifyFix({
      patchApplied: true,
      beforeFixResult: beforeFix.result,
      postFixOutcome: postFix.outcome,
      regressionOutcome: regression.outcome,
    });

    return completedResult({
      targetCommitSha: checkout.resolvedCommitSha,
      proposal,
      patches,
      result: classification.result,
      stdout: stdoutParts.join('\n\n'),
      stderr: stderrParts.join('\n\n'),
      errorMessage: classification.result === 'FIX_VERIFIED' ? null : classification.reason,
      validationSummary: {
        patchApplied: true,
        reproductionBeforeFix: { result: beforeFix.result, reason: beforeFix.reason },
        postFixValidation: { outcome: postFix.outcome, reason: postFix.reason },
        regressionTests: { outcome: regression.outcome, total: regression.total, failed: regression.failed, reason: regression.reason },
        result: classification.result,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (stage === 'checkout') {
      return completedResult({
        targetCommitSha: input.targetCommitSha,
        proposal,
        result: 'INCONCLUSIVE',
        errorMessage: `REPOSITORY_CHECKOUT_FAILED: ${message}`,
      });
    }
    return failedResult(`SANDBOX_EXECUTION_FAILED: ${message}`, checkout?.resolvedCommitSha ?? input.targetCommitSha, proposal, patches);
  } finally {
    await sandbox.destroy();
    if (checkout) await checkout.cleanup();
  }
}
