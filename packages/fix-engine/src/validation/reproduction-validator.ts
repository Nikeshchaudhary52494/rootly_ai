import { classifyReproduction } from '@incident-ai/reproduction';
import type { ClassificationOutput, SandboxExecutionResult } from '@incident-ai/reproduction';

/**
 * Confirms the ORIGINAL Phase 6 reproduction test still shows the bug at
 * this exact commit, inside this fresh sandbox, *before* the patch is
 * applied — the "before" half of the before/after evidence this phase is
 * built around. Reuses Phase 6's own classifier: the semantics ("did this
 * test observe the production failure") are identical here.
 */
export function evaluateBeforeFixReproduction(execResult: SandboxExecutionResult): ClassificationOutput {
  return classifyReproduction({
    exitCode: execResult.exitCode,
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    timedOut: execResult.timedOut,
  });
}

// Same signatures Phase 6 watches for — a test environment failing to launch
// is not evidence the fix works, any more than it was evidence the bug existed.
const INFRA_FAILURE_PATTERNS: RegExp[] = [
  /Cannot find module/i,
  /Test suite failed to run/i,
  /SyntaxError/i,
  /Jest encountered an unexpected token/i,
  /ENOENT/i,
  /EACCES/i,
  /command not found/i,
  /npm ERR!/i,
  /MODULE_NOT_FOUND/i,
];

export type PostFixOutcome = 'PASSED' | 'FAILED' | 'INFRA_ERROR';

export interface PostFixValidationOutcome {
  outcome: PostFixOutcome;
  reason: string;
}

/**
 * Inverted polarity from the before-fix check: here PASSED means the
 * originally-observed failure no longer occurs.
 */
export function evaluatePostFixValidation(execResult: SandboxExecutionResult): PostFixValidationOutcome {
  if (execResult.timedOut) {
    return { outcome: 'INFRA_ERROR', reason: 'Post-fix validation timed out.' };
  }
  if (execResult.exitCode === null) {
    return { outcome: 'INFRA_ERROR', reason: 'Post-fix validation did not report an exit code.' };
  }

  const combined = `${execResult.stdout}\n${execResult.stderr}`;
  if (INFRA_FAILURE_PATTERNS.some((pattern) => pattern.test(combined))) {
    return {
      outcome: 'INFRA_ERROR',
      reason: 'The test environment failed before the post-fix assertion could run (missing module, syntax error, or similar).',
    };
  }

  return execResult.exitCode === 0
    ? { outcome: 'PASSED', reason: 'The post-fix validation test passed — the original failure no longer occurs.' }
    : { outcome: 'FAILED', reason: 'The post-fix validation test still fails — the fix did not resolve the incident.' };
}
