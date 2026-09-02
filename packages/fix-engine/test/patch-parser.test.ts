import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyChangesToFile, renderUnifiedDiff } from '../src/patch/patch-parser';
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

test('applies a single-line change', () => {
  const original = 'function confirmPayment(payment) {\n  return payment.customer.id;\n}\n';
  const patched = applyChangesToFile(original, [change()]);
  assert.equal(patched, 'function confirmPayment(payment) {\n  return payment.customer?.id ?? null;\n}\n');
});

test('applies a multi-line replacement', () => {
  const original = 'a\nb\nc\nd\n';
  const patched = applyChangesToFile(original, [
    change({ startLine: 2, endLine: 3, originalCode: 'b\nc', replacementCode: 'X\nY\nZ' }),
  ]);
  assert.equal(patched, 'a\nX\nY\nZ\nd\n');
});

test('applies multiple non-overlapping changes to the same file without line-shift corruption', () => {
  const original = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
  const patched = applyChangesToFile(original, [
    change({ startLine: 1, endLine: 1, originalCode: 'line1', replacementCode: 'LINE1' }),
    change({ startLine: 4, endLine: 4, originalCode: 'line4', replacementCode: 'LINE4-CHANGED' }),
  ]);
  assert.equal(patched, ['LINE1', 'line2', 'line3', 'LINE4-CHANGED', 'line5'].join('\n'));
});

test('can delete a line entirely via an empty replacement', () => {
  const original = 'a\nb\nc\n';
  const patched = applyChangesToFile(original, [change({ startLine: 2, endLine: 2, originalCode: 'b', replacementCode: '' })]);
  assert.equal(patched, 'a\n\nc\n');
});

test('renderUnifiedDiff: shows removed and added lines with correct headers', () => {
  const diff = renderUnifiedDiff('a.js', 'a\nb\nc', 'a\nB\nc');
  assert.match(diff, /^--- a\/a\.js/);
  assert.match(diff, /\+\+\+ b\/a\.js/);
  assert.match(diff, /^-b$/m);
  assert.match(diff, /^\+B$/m);
  assert.match(diff, /^ a$/m); // unchanged context line
});

test('renderUnifiedDiff: identical content produces only context lines', () => {
  const diff = renderUnifiedDiff('a.js', 'same\ncontent', 'same\ncontent');
  assert.doesNotMatch(diff, /^[+-](?!\+\+|--)/m);
});
