export type FixClassification = 'FIX_VERIFIED' | 'FIX_REJECTED' | 'INCONCLUSIVE';

export interface FixClassificationInput {
  patchApplied: boolean;
  beforeFixResult: 'REPRODUCED' | 'NOT_REPRODUCED' | 'INCONCLUSIVE' | null;
  postFixOutcome: 'PASSED' | 'FAILED' | 'INFRA_ERROR' | null;
  regressionOutcome: 'PASSED' | 'FAILED' | 'INFRA_ERROR' | 'SKIPPED' | null;
}

export interface FixClassificationOutput {
  result: FixClassification;
  reason: string;
}

/**
 * The one place that decides FIX_VERIFIED — never the LLM, never an AI
 * confidence score. Every branch here is grounded in something the sandbox
 * actually observed. Order matters: each check only applies once the
 * previous one ruled out a more fundamental problem, so a single root cause
 * (e.g. an unreproducible baseline) doesn't get misreported as something
 * more specific than it is.
 */
export function classifyFix(input: FixClassificationInput): FixClassificationOutput {
  if (!input.patchApplied) {
    return { result: 'FIX_REJECTED', reason: 'The patch could not be applied to the checked-out repository.' };
  }

  if (input.beforeFixResult === 'INCONCLUSIVE') {
    return {
      result: 'INCONCLUSIVE',
      reason: 'Could not confirm the baseline reproduction inside the fresh sandbox before validating the fix.',
    };
  }
  if (input.beforeFixResult === 'NOT_REPRODUCED') {
    return {
      result: 'INCONCLUSIVE',
      reason: 'The original reproduction test no longer reproduces the bug at this commit even before the fix — the fix cannot be meaningfully validated.',
    };
  }

  if (input.postFixOutcome === 'INFRA_ERROR') {
    return { result: 'INCONCLUSIVE', reason: 'The post-fix validation test could not run to completion (environment failure).' };
  }
  if (input.postFixOutcome === 'FAILED') {
    return { result: 'FIX_REJECTED', reason: 'The post-fix validation test still fails — the incident is not resolved.' };
  }

  if (input.regressionOutcome === 'INFRA_ERROR') {
    return { result: 'INCONCLUSIVE', reason: 'Regression tests could not run to completion (environment failure).' };
  }
  if (input.regressionOutcome === 'FAILED') {
    return { result: 'FIX_REJECTED', reason: 'Fix resolves the incident but breaks existing tests.' };
  }

  return {
    result: 'FIX_VERIFIED',
    reason: 'The patch applied cleanly, the post-fix validation test passes, and regression tests pass.',
  };
}
