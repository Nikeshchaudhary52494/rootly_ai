export type ReproductionClassification = 'REPRODUCED' | 'NOT_REPRODUCED' | 'INCONCLUSIVE';

export interface ClassificationInput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ClassificationOutput {
  result: ReproductionClassification;
  reason: string;
}

// Signatures of the test process itself failing to run — a missing module, a
// syntax error, npm/OS-level failures — as opposed to the test running fine
// and its assertion simply not holding. Order matters: checked before exit code.
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

/**
 * Deterministic, code-only classification — the LLM never gets a vote here.
 * REPRODUCED requires the test process to have actually run and *passed*
 * (i.e. its assertion of the expected failure held); a clean run whose
 * assertion didn't hold is NOT_REPRODUCED; anything that prevented the test
 * from meaningfully running at all is INCONCLUSIVE, never NOT_REPRODUCED.
 */
export function classifyReproduction(input: ClassificationInput): ClassificationOutput {
  if (input.timedOut) {
    return { result: 'INCONCLUSIVE', reason: 'Sandbox execution timed out.' };
  }

  if (input.exitCode === null) {
    return { result: 'INCONCLUSIVE', reason: 'Test process did not report an exit code.' };
  }

  const combinedOutput = `${input.stdout}\n${input.stderr}`;
  const infraFailure = INFRA_FAILURE_PATTERNS.find((pattern) => pattern.test(combinedOutput));
  if (infraFailure) {
    return {
      result: 'INCONCLUSIVE',
      reason: 'The test environment failed before the reproduction assertion could run (missing module, syntax error, or similar) — this is not evidence the bug is absent.',
    };
  }

  if (input.exitCode === 0) {
    return {
      result: 'REPRODUCED',
      reason: 'The reproduction test executed and its assertion of the expected failure passed.',
    };
  }

  return {
    result: 'NOT_REPRODUCED',
    reason: 'The reproduction test ran to completion but its assertion of the expected failure did not hold.',
  };
}
