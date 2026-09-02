import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFixAttempt } from '../src/fix/fix-engine';
import { loadFixSandboxConfig } from '../src/sandbox/fix-sandbox';
import { buildFixGenerationInput } from './fixtures';
import { FakeLLM } from './fake-llm';

const execFileAsync = promisify(execFile);

// The Docker-level isolation properties (no network, no docker.sock, no forwarded
// secrets, timeout kills the container, container removed after success/failure)
// belong to DockerSandbox itself and are already exhaustively proven in
// packages/reproduction/test/docker-sandbox.security.test.ts — the fix engine
// reuses that class unmodified (see sandbox/fix-sandbox.ts), so re-testing them
// here would just duplicate that suite. What's genuinely fix-engine-specific and
// unproven elsewhere is runFixAttempt's own cleanup guarantee: the sandbox it
// creates must never survive an early, non-happy-path exit.
const IMAGE = process.env.REPRODUCTION_DOCKER_IMAGE || 'incident-ai-reproduction-sandbox';

async function containerNames(): Promise<string[]> {
  const { stdout } = await execFileAsync('docker', ['ps', '-a', '--filter', 'name=incident-ai-repro-', '--format', '{{.Names}}']);
  return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

async function makeLocalRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'incident-ai-fix-security-'));
  const run = (args: string[]) => execFileAsync('git', args, { cwd: dir });

  // A deliberately non-buggy version of the function: no crash exists, so a
  // reproduction test asserting a throw cannot pass here — this repo exists
  // only to drive runFixAttempt to an early NOT_REPRODUCED exit.
  await writeFile(
    join(dir, 'math.service.js'),
    ['function getFirst(list) {', "  return (list[0] ?? '').toUpperCase();", '}', '', 'module.exports = { getFirst };', ''].join('\n'),
    'utf8',
  );

  await run(['init', '--quiet']);
  await run(['config', 'user.email', 'test@example.com']);
  await run(['config', 'user.name', 'Test']);
  await run(['add', 'math.service.js']);
  await run(['commit', '--quiet', '-m', 'init']);

  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test(
  'a sandbox created for a run that exits early (bug not reproduced) is never left running',
  { timeout: 30000 },
  async () => {
    const repo = await makeLocalRepo();
    try {
      const before = await containerNames();

      const llm = new FakeLLM()
        .enqueueValid(() => ({
          targetFile: 'math.service.js',
          targetFunctionOrExport: 'getFirst',
          rootCauseSummary: 'getFirst may crash on an empty list.',
          proposedApproach: 'Guard against an empty list before calling toUpperCase.',
        }))
        .enqueueValid(() => ({
          summary: 'Guard against an empty list.',
          rootCause: 'toUpperCase is called on a possibly-undefined first element.',
          changes: [
            {
              filePath: 'math.service.js',
              startLine: 2,
              endLine: 2,
              originalCode: "  return (list[0] ?? '').toUpperCase();",
              replacementCode: "  return (list[0] ?? '').toUpperCase();",
              explanation: 'no-op placeholder, never reached in this test',
            },
          ],
          patch: '',
          testsExpectedToPass: [],
          risks: [],
        }));

      const mathContent = ['function getFirst(list) {', "  return (list[0] ?? '').toUpperCase();", '}', '', 'module.exports = { getFirst };', ''].join(
        '\n',
      );

      const input = buildFixGenerationInput({
        reproduction: {
          generatedTest: [
            "const { getFirst } = require('../math.service');",
            "describe('x', () => {",
            "  it('throws on empty list', () => {",
            '    expect(() => getFirst([])).toThrow();',
            '  });',
            '});',
            '',
          ].join('\n'),
          testFilePath: 'reproduction-tests/get-first.spec.js',
          result: 'REPRODUCED',
          stdout: '',
          stderr: '',
        },
        codeContext: {
          primaryFilePath: 'math.service.js',
          primaryLineNumber: 2,
          files: [
            {
              filePath: 'math.service.js',
              functionName: 'getFirst',
              content: mathContent,
              contentStartLine: 1,
              contentEndLine: 6,
            },
          ],
          relatedTests: [],
          recentCommits: [],
        },
      });

      const result = await runFixAttempt(
        { targetCommitSha: 'HEAD', repositoryUrl: repo.dir, fixGenerationInput: input },
        { llm, sandboxConfig: loadFixSandboxConfig({ REPRODUCTION_DOCKER_IMAGE: IMAGE, FIX_VALIDATION_TIMEOUT_MS: '20000' }) },
      );

      assert.equal(result.status, 'COMPLETED');
      assert.equal(result.validationSummary?.patchApplied, false);
      assert.notEqual(result.validationSummary?.reproductionBeforeFix.result, 'REPRODUCED');

      const after = await containerNames();
      assert.deepEqual(after, before, 'no fix-sandbox container should remain running after an early exit');
    } finally {
      await repo.cleanup();
    }
  },
);
