import { buildJestCommand } from '@rootly.ai/reproduction';

/**
 * Every command run inside the fix sandbox is a backend-built argv array —
 * never AI output, never a shell string. See Phase 6's test-runner.ts for
 * the same principle; these just name the fix-specific call sites.
 */

export function buildReproductionCheckCommand(testFilePath: string): string[] {
  return buildJestCommand(testFilePath);
}

export function buildPostFixValidationCommand(testFilePath: string): string[] {
  return buildJestCommand(testFilePath);
}

export function buildRegressionCommand(testFilePaths: string[]): string[] {
  return ['jest', ...testFilePaths, '--ci', '--runInBand'];
}
