import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePromotionPatchSet, validateChangedFileSet } from '../src/promotion/promotion-validator';

function diffOf(added: number, removed: number): string {
  const lines = ['--- a/x', '+++ b/x'];
  for (let i = 0; i < added; i++) lines.push('+line');
  for (let i = 0; i < removed; i++) lines.push('-line');
  return lines.join('\n');
}

test('validatePromotionPatchSet: rejects an empty patch set', () => {
  const result = validatePromotionPatchSet([]);
  assert.equal(result.valid, false);
});

test('validatePromotionPatchSet: accepts a small, ordinary patch', () => {
  const result = validatePromotionPatchSet([{ filePath: 'src/a.js', diff: diffOf(1, 1) }]);
  assert.equal(result.valid, true);
});

test('validatePromotionPatchSet: rejects a patch touching .env', () => {
  const result = validatePromotionPatchSet([{ filePath: '.env', diff: diffOf(1, 1) }]);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(), /\.env/);
});

test('validatePromotionPatchSet: rejects a patch touching .git internals', () => {
  const result = validatePromotionPatchSet([{ filePath: '.git/config', diff: diffOf(1, 1) }]);
  assert.equal(result.valid, false);
});

test('validatePromotionPatchSet: rejects path traversal', () => {
  const result = validatePromotionPatchSet([{ filePath: '../outside.js', diff: diffOf(1, 1) }]);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(), /traversal/);
});

test('validatePromotionPatchSet: rejects a patch exceeding the file-count limit', () => {
  const files = Array.from({ length: 6 }, (_, i) => ({ filePath: `src/${i}.js`, diff: diffOf(1, 1) }));
  const result = validatePromotionPatchSet(files, { maxFiles: 5, maxChangedLines: 1000, maxPatchBytes: 100000 });
  assert.equal(result.valid, false);
});

test('validatePromotionPatchSet: rejects a patch exceeding the changed-line limit', () => {
  const result = validatePromotionPatchSet(
    [{ filePath: 'src/a.js', diff: diffOf(200, 0) }],
    { maxFiles: 5, maxChangedLines: 100, maxPatchBytes: 100000 },
  );
  assert.equal(result.valid, false);
});

test('validateChangedFileSet: passes when exactly the expected files changed', () => {
  const result = validateChangedFileSet(['src/a.js', 'src/b.js'], ['src/a.js', 'src/b.js']);
  assert.equal(result.valid, true);
});

test('validateChangedFileSet: fails when an unexpected file changed', () => {
  const result = validateChangedFileSet(['src/a.js'], ['src/a.js', '.env']);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(), /unexpected file/);
});

test('validateChangedFileSet: fails when an expected file was not actually changed', () => {
  const result = validateChangedFileSet(['src/a.js', 'src/b.js'], ['src/a.js']);
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(), /was not changed/);
});
