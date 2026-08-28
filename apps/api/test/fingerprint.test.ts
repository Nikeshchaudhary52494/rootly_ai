import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeErrorMessage } from '../src/incidents/utils/message-normalizer';
import { extractRelevantStackFrames } from '../src/incidents/utils/stack-normalizer';
import { generateFingerprint, generateIncidentTitle } from '../src/incidents/utils/fingerprint';

test('message normalization: numbers collapse to <number>', () => {
  assert.equal(normalizeErrorMessage('User 123 not found'), 'User <number> not found');
  assert.equal(normalizeErrorMessage('User 123 not found'), normalizeErrorMessage('User 456 not found'));
});

test('message normalization: UUIDs collapse to <uuid>', () => {
  assert.equal(
    normalizeErrorMessage('Resource 550e8400-e29b-41d4-a716-446655440000 missing'),
    'Resource <uuid> missing',
  );
});

test('message normalization: emails collapse to <email>', () => {
  assert.equal(normalizeErrorMessage('No user for john@example.com'), 'No user for <email>');
});

test('message normalization: long hex ids collapse to <id>', () => {
  assert.equal(normalizeErrorMessage('Object abc123def456 not found'), 'Object <id> not found');
});

test('message normalization: URLs with numeric ids normalize the id segment', () => {
  assert.equal(normalizeErrorMessage('GET /users/123 failed'), 'GET /users/<number> failed');
});

test('stack normalization: removes line/column numbers', () => {
  const stack = [
    'TypeError: x',
    '    at PaymentService.confirm (src/services/payment.service.ts:82:14)',
  ].join('\n');
  assert.deepEqual(extractRelevantStackFrames(stack), ['src/services/payment.service.ts']);
});

test('stack normalization: skips node_modules frames', () => {
  const stack = [
    'Error: x',
    '    at PaymentService.confirm (src/services/payment.service.ts:82:14)',
    '    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)',
  ].join('\n');
  assert.deepEqual(extractRelevantStackFrames(stack), ['src/services/payment.service.ts']);
});

test('stack normalization: keeps application frames, up to the limit', () => {
  const stack = [
    'Error: x',
    '    at a (src/a.ts:1:1)',
    '    at b (src/b.ts:2:2)',
    '    at c (src/c.ts:3:3)',
    '    at d (src/d.ts:4:4)',
  ].join('\n');
  assert.deepEqual(extractRelevantStackFrames(stack), ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('stack normalization: handles missing stack gracefully', () => {
  assert.deepEqual(extractRelevantStackFrames(undefined), []);
});

test('fingerprint: same input produces same fingerprint', () => {
  const a = generateFingerprint('TypeError', 'Cannot read properties of undefined', 'at a (src/x.ts:1:1)');
  const b = generateFingerprint('TypeError', 'Cannot read properties of undefined', 'at a (src/x.ts:9:9)');
  assert.equal(a, b);
});

test('fingerprint: different error name produces different fingerprint', () => {
  const a = generateFingerprint('TypeError', 'boom');
  const b = generateFingerprint('RangeError', 'boom');
  assert.notEqual(a, b);
});

test('fingerprint: dynamic numbers in message normalize to the same fingerprint', () => {
  const a = generateFingerprint('Error', 'User 123 not found');
  const b = generateFingerprint('Error', 'User 456 not found');
  assert.equal(a, b);
});

test('fingerprint: different application source file changes the fingerprint', () => {
  const a = generateFingerprint('Error', 'boom', 'at f (src/services/payment.service.ts:1:1)');
  const b = generateFingerprint('Error', 'boom', 'at f (src/services/other.service.ts:1:1)');
  assert.notEqual(a, b);
});

test('title generation: formats as "errorName: errorMessage" and truncates at 200 chars', () => {
  assert.equal(generateIncidentTitle('TypeError', 'Cannot read properties of undefined'), 'TypeError: Cannot read properties of undefined');
  const long = generateIncidentTitle('Error', 'x'.repeat(300));
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('...'));
});
