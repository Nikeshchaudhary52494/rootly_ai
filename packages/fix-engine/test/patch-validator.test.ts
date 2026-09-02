import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePatchSafety, verifyOriginalContent, DEFAULT_PATCH_SAFETY_LIMITS } from '../src/patch/patch-validator';
import type { FileChange } from '../src/schemas/fix-proposal.schema';

function change(overrides: Partial<FileChange> = {}): FileChange {
  return {
    filePath: 'src/services/payment.service.js',
    startLine: 2,
    endLine: 2,
    originalCode: '  return payment.customer.id;',
    replacementCode: '  return payment.customer?.id ?? null;',
    explanation: 'Guard against a missing customer.',
    ...overrides,
  };
}

test('accepts a well-formed single-file change', () => {
  const result = validatePatchSafety([change()]);
  assert.equal(result.valid, true);
});

test('rejects an absolute path', () => {
  const result = validatePatchSafety([change({ filePath: '/etc/passwd' })]);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('absolute')));
});

test('rejects a path with .. traversal', () => {
  const result = validatePatchSafety([change({ filePath: '../../etc/passwd' })]);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('traversal')));
});

test('rejects .env modification', () => {
  const result = validatePatchSafety([change({ filePath: '.env' })]);
  assert.equal(result.valid, false);
});

test('rejects .git modification', () => {
  const result = validatePatchSafety([change({ filePath: '.git/config' })]);
  assert.equal(result.valid, false);
});

test('rejects package.json modification', () => {
  const result = validatePatchSafety([change({ filePath: 'package.json' })]);
  assert.equal(result.valid, false);
});

test('rejects package-lock.json modification', () => {
  const result = validatePatchSafety([change({ filePath: 'package-lock.json' })]);
  assert.equal(result.valid, false);
});

test('rejects Dockerfile modification', () => {
  const result = validatePatchSafety([change({ filePath: 'Dockerfile' })]);
  assert.equal(result.valid, false);
});

test('rejects GitHub workflow modification', () => {
  const result = validatePatchSafety([change({ filePath: '.github/workflows/ci.yml' })]);
  assert.equal(result.valid, false);
});

test('rejects a patch touching more files than the limit', () => {
  const changes = Array.from({ length: 6 }, (_, i) => change({ filePath: `src/file-${i}.js` }));
  const result = validatePatchSafety(changes, { ...DEFAULT_PATCH_SAFETY_LIMITS, maxFiles: 5 });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('files')));
});

test('rejects a patch exceeding the changed-line limit', () => {
  const bigChange = change({
    originalCode: Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n'),
    replacementCode: Array.from({ length: 60 }, (_, i) => `new line ${i}`).join('\n'),
    startLine: 1,
    endLine: 50,
  });
  const result = validatePatchSafety([bigChange], { ...DEFAULT_PATCH_SAFETY_LIMITS, maxChangedLines: 20 });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('lines')));
});

test('rejects a patch exceeding the byte-size limit', () => {
  const hugeChange = change({ replacementCode: 'x'.repeat(1000) });
  const result = validatePatchSafety([hugeChange], { ...DEFAULT_PATCH_SAFETY_LIMITS, maxPatchBytes: 100 });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((r) => r.includes('bytes')));
});

test('rejects endLine before startLine', () => {
  const result = validatePatchSafety([change({ startLine: 10, endLine: 5 })]);
  assert.equal(result.valid, false);
});

test('verifyOriginalContent: true when the claimed lines match exactly', () => {
  const content = 'function confirmPayment(payment) {\n  return payment.customer.id;\n}\n';
  assert.equal(verifyOriginalContent(content, change({ startLine: 2, endLine: 2, originalCode: '  return payment.customer.id;' })), true);
});

test('verifyOriginalContent: false when the content does not match (hallucinated original)', () => {
  const content = 'function confirmPayment(payment) {\n  return payment.customer.id;\n}\n';
  assert.equal(
    verifyOriginalContent(content, change({ startLine: 2, endLine: 2, originalCode: '  return payment.customer.name;' })),
    false,
  );
});

test('verifyOriginalContent: false when the line range is out of bounds', () => {
  const content = 'line 1\nline 2\n';
  assert.equal(verifyOriginalContent(content, change({ startLine: 10, endLine: 12, originalCode: 'anything' })), false);
});
