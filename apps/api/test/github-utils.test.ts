import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubRepositoryUrl } from '../src/github/utils/repository-parser';
import { parseStackTrace } from '../src/github/utils/stack-trace-parser';
import { matchSourceFile } from '../src/github/utils/source-file-matcher';
import { extractCodeWindow } from '../src/incident-context/utils/code-window';
import { findRelatedTestPaths } from '../src/incident-context/utils/related-tests';

// --- repository URL parsing ---

test('repository URL: parses an https GitHub URL', () => {
  assert.deepEqual(parseGithubRepositoryUrl('https://github.com/owner/repository'), {
    owner: 'owner',
    name: 'repository',
  });
});

test('repository URL: parses an https .git URL', () => {
  assert.deepEqual(parseGithubRepositoryUrl('https://github.com/owner/repository.git'), {
    owner: 'owner',
    name: 'repository',
  });
});

test('repository URL: parses an SSH URL', () => {
  assert.deepEqual(parseGithubRepositoryUrl('git@github.com:thinklylabs/incident-ai.git'), {
    owner: 'thinklylabs',
    name: 'incident-ai',
  });
});

test('repository URL: rejects an invalid URL', () => {
  assert.throws(() => parseGithubRepositoryUrl('not-a-url'));
  assert.throws(() => parseGithubRepositoryUrl('https://gitlab.com/owner/repository'));
});

// --- stack trace parsing ---

test('stack trace: parses a standard Node stack with function name', () => {
  const stack = [
    'TypeError: Cannot read properties of undefined',
    '    at PaymentService.confirm (/app/src/services/payment.service.ts:82:14)',
    '    at PaymentController.confirm (/app/src/controllers/payment.controller.ts:45:10)',
  ].join('\n');

  const { frames } = parseStackTrace(stack);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0], {
    functionName: 'PaymentService.confirm',
    filePath: 'src/services/payment.service.ts',
    line: 82,
    column: 14,
  });
  assert.deepEqual(frames[1], {
    functionName: 'PaymentController.confirm',
    filePath: 'src/controllers/payment.controller.ts',
    line: 45,
    column: 10,
  });
});

test('stack trace: strips known absolute-path roots', () => {
  const cases = [
    '/app/src/services/payment.service.ts',
    '/usr/src/app/src/services/payment.service.ts',
    '/home/node/app/src/services/payment.service.ts',
  ];
  for (const path of cases) {
    const { frames } = parseStackTrace(`Error: x\n    at f (${path}:10:1)`);
    assert.equal(frames[0].filePath, 'src/services/payment.service.ts');
  }
});

test('stack trace: handles a relative path frame without a function name', () => {
  const { frames } = parseStackTrace('Error: x\n    at src/index.ts:5:2');
  assert.deepEqual(frames[0], { functionName: null, filePath: 'src/index.ts', line: 5, column: 2 });
});

test('stack trace: handles a frame missing a line number', () => {
  const { frames } = parseStackTrace('Error: x\n    at f (native)');
  assert.deepEqual(frames[0], { functionName: 'f', filePath: 'native', line: null, column: null });
});

test('stack trace: handles a missing stack gracefully', () => {
  assert.deepEqual(parseStackTrace(undefined), { frames: [] });
});

// --- source file matching ---

const REPO_TREE = ['src/services/payment.service.ts', 'src/controllers/payment.controller.ts', 'README.md'];

test('source matching: exact match', () => {
  assert.equal(matchSourceFile('src/services/payment.service.ts', REPO_TREE), 'src/services/payment.service.ts');
});

test('source matching: suffix match against a path with an unknown prefix', () => {
  assert.equal(
    matchSourceFile('/usr/lib/somewhere/src/services/payment.service.ts', REPO_TREE),
    'src/services/payment.service.ts',
  );
});

test('source matching: longest suffix wins over a shorter ambiguous one', () => {
  const tree = ['moduleA/src/payment.service.ts', 'moduleB/src/payment.service.ts'];
  // Full relative path is unique even though the bare filename would be ambiguous.
  assert.equal(matchSourceFile('/app/moduleA/src/payment.service.ts', tree), 'moduleA/src/payment.service.ts');
});

test('source matching: ambiguous match is left unresolved', () => {
  const tree = ['moduleA/payment.service.ts', 'moduleB/payment.service.ts'];
  assert.equal(matchSourceFile('payment.service.ts', tree), null);
});

test('source matching: no match is unresolved', () => {
  assert.equal(matchSourceFile('src/unrelated.ts', REPO_TREE), null);
});

// --- code window extraction ---

test('code window: middle of file gets 20 lines of context on each side', () => {
  const content = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
  const window = extractCodeWindow(content, 100);
  assert.equal(window.contentStartLine, 80);
  assert.equal(window.contentEndLine, 120);
  assert.equal(window.content.split('\n').length, 41);
});

test('code window: near the beginning of file clamps the start', () => {
  const content = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n');
  const window = extractCodeWindow(content, 5);
  assert.equal(window.contentStartLine, 1);
  assert.equal(window.contentEndLine, 25);
});

test('code window: near the end of file clamps the end', () => {
  const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join('\n');
  const window = extractCodeWindow(content, 48);
  assert.equal(window.contentStartLine, 28);
  assert.equal(window.contentEndLine, 50);
});

// --- related test discovery ---

test('related tests: finds a sibling .test.ts file', () => {
  const tree = ['src/services/payment.service.ts', 'src/services/payment.service.test.ts'];
  assert.deepEqual(findRelatedTestPaths('src/services/payment.service.ts', tree), [
    'src/services/payment.service.test.ts',
  ]);
});

test('related tests: finds a sibling .spec.ts file', () => {
  const tree = ['src/services/payment.service.ts', 'src/services/payment.service.spec.ts'];
  assert.deepEqual(findRelatedTestPaths('src/services/payment.service.ts', tree), [
    'src/services/payment.service.spec.ts',
  ]);
});

test('related tests: finds a file under __tests__', () => {
  const tree = ['src/services/payment.service.ts', '__tests__/payment.service.test.ts'];
  assert.deepEqual(findRelatedTestPaths('src/services/payment.service.ts', tree), [
    '__tests__/payment.service.test.ts',
  ]);
});

test('related tests: finds a file under a tests/ directory', () => {
  const tree = ['src/services/payment.service.ts', 'tests/services/payment.service.test.ts'];
  assert.deepEqual(findRelatedTestPaths('src/services/payment.service.ts', tree), [
    'tests/services/payment.service.test.ts',
  ]);
});

test('related tests: returns nothing when no tests exist', () => {
  const tree = ['src/services/payment.service.ts', 'README.md'];
  assert.deepEqual(findRelatedTestPaths('src/services/payment.service.ts', tree), []);
});
