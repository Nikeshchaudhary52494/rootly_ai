import type { SandboxExecutionResult } from '@incident-ai/reproduction';

export interface JestSummary {
  total: number;
  passed: number;
  failed: number;
}

/** Parses Jest's "Tests: 1 failed, 13 passed, 14 total" summary line (order/subset varies by outcome). */
export function parseJestSummary(output: string): JestSummary | null {
  const match = output.match(/Tests:\s+(.+)/);
  if (!match) return null;

  let total = 0;
  let passed = 0;
  let failed = 0;
  let sawAny = false;

  for (const part of match[1].split(',')) {
    const piece = part.match(/(\d+)\s+(\w+)/);
    if (!piece) continue;
    const count = Number(piece[1]);
    sawAny = true;
    if (piece[2] === 'passed') passed = count;
    else if (piece[2] === 'failed') failed = count;
    else if (piece[2] === 'total') total = count;
  }

  return sawAny ? { total, passed, failed } : null;
}

export type RegressionOutcome = 'PASSED' | 'FAILED' | 'INFRA_ERROR' | 'SKIPPED';

export interface RegressionResult {
  outcome: RegressionOutcome;
  total: number;
  failed: number;
  reason: string;
}

/** No regression tests to run is a trivial pass — there's nothing the patch could have broken. */
export function skippedRegressionResult(): RegressionResult {
  return { outcome: 'SKIPPED', total: 0, failed: 0, reason: 'No relevant existing tests were found to run.' };
}

export function evaluateRegressionResult(execResult: SandboxExecutionResult): RegressionResult {
  if (execResult.timedOut) {
    return { outcome: 'INFRA_ERROR', total: 0, failed: 0, reason: 'Regression tests timed out.' };
  }

  const combined = `${execResult.stdout}\n${execResult.stderr}`;
  const summary = parseJestSummary(combined);
  if (!summary) {
    return { outcome: 'INFRA_ERROR', total: 0, failed: 0, reason: 'Could not determine regression test results from the test run output.' };
  }

  return {
    outcome: summary.failed === 0 ? 'PASSED' : 'FAILED',
    total: summary.total,
    failed: summary.failed,
    reason:
      summary.failed === 0
        ? `All ${summary.total} regression test(s) passed.`
        : `${summary.failed} of ${summary.total} regression test(s) failed.`,
  };
}
