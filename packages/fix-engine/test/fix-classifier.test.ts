import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFix } from '../src/validation/fix-classifier';

test('patch could not be applied -> FIX_REJECTED', () => {
  const outcome = classifyFix({ patchApplied: false, beforeFixResult: 'REPRODUCED', postFixOutcome: null, regressionOutcome: null });
  assert.equal(outcome.result, 'FIX_REJECTED');
});

test('everything passes -> FIX_VERIFIED', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'PASSED',
    regressionOutcome: 'PASSED',
  });
  assert.equal(outcome.result, 'FIX_VERIFIED');
});

test('no regression tests to run (SKIPPED) still counts as verified', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'PASSED',
    regressionOutcome: 'SKIPPED',
  });
  assert.equal(outcome.result, 'FIX_VERIFIED');
});

test('post-fix validation still fails -> FIX_REJECTED', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'FAILED',
    regressionOutcome: 'PASSED',
  });
  assert.equal(outcome.result, 'FIX_REJECTED');
});

test('post-fix passes but regression tests fail -> FIX_REJECTED (fix resolves bug but breaks other tests)', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'PASSED',
    regressionOutcome: 'FAILED',
  });
  assert.equal(outcome.result, 'FIX_REJECTED');
  assert.match(outcome.reason, /breaks existing tests/);
});

test('baseline could not be reproduced in the fresh sandbox -> INCONCLUSIVE, not FIX_REJECTED', () => {
  const outcome = classifyFix({ patchApplied: true, beforeFixResult: 'INCONCLUSIVE', postFixOutcome: null, regressionOutcome: null });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('baseline no longer reproduces even before the fix -> INCONCLUSIVE', () => {
  const outcome = classifyFix({ patchApplied: true, beforeFixResult: 'NOT_REPRODUCED', postFixOutcome: null, regressionOutcome: null });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('post-fix validation environment failure -> INCONCLUSIVE, not FIX_REJECTED', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'INFRA_ERROR',
    regressionOutcome: null,
  });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('regression environment failure -> INCONCLUSIVE, not FIX_REJECTED', () => {
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'PASSED',
    regressionOutcome: 'INFRA_ERROR',
  });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('AI confidence is never a factor — classifier only takes execution evidence', () => {
  // classifyFix's type signature has no confidence field at all; this test documents that fact.
  const outcome = classifyFix({
    patchApplied: true,
    beforeFixResult: 'REPRODUCED',
    postFixOutcome: 'PASSED',
    regressionOutcome: 'PASSED',
  });
  assert.equal(Object.keys(outcome).includes('confidence'), false);
});
