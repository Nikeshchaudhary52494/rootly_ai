/**
 * Every command run inside the sandbox is an argv array built here by the
 * backend — never a raw string, and never anything derived from AI output.
 * The generated test's *content* runs; its *instructions* never do.
 */

export function buildJestCommand(testFilePath: string): string[] {
  return ['jest', testFilePath, '--ci', '--runInBand'];
}

export function buildInstallCommand(hasLockfile: boolean): string[] {
  return hasLockfile
    ? ['npm', 'ci', '--prefer-offline', '--no-audit', '--no-fund']
    : ['npm', 'install', '--prefer-offline', '--no-audit', '--no-fund'];
}
