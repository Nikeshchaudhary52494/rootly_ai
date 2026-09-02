import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePatchHash, verifyPatchIntegrity } from '../src/patch/patch-integrity';

test('computePatchHash: deterministic for the same input', () => {
  const patch = '--- a/x\n+++ b/x\n';
  assert.equal(computePatchHash(patch), computePatchHash(patch));
});

test('computePatchHash: differs for different input', () => {
  assert.notEqual(computePatchHash('a'), computePatchHash('b'));
});

test('computePatchHash: is prefixed with the algorithm name', () => {
  assert.match(computePatchHash('a'), /^sha256:[0-9a-f]{64}$/);
});

test('verifyPatchIntegrity: passes when the patch matches its recorded hash', () => {
  const patch = 'the exact validated patch';
  const hash = computePatchHash(patch);
  assert.equal(verifyPatchIntegrity(patch, hash), true);
});

test('verifyPatchIntegrity: fails when even a single character has changed', () => {
  const patch = 'the exact validated patch';
  const hash = computePatchHash(patch);
  assert.equal(verifyPatchIntegrity(patch + ' ', hash), false);
});

test('verifyPatchIntegrity: fails against an unrelated hash', () => {
  assert.equal(verifyPatchIntegrity('anything', 'sha256:0000000000000000000000000000000000000000000000000000000000000000'), false);
});
