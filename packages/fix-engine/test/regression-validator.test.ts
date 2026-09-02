import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJestSummary, evaluateRegressionResult, skippedRegressionResult } from '../src/validation/regression-validator';

test('parses a summary line with failures', () => {
  const summary = parseJestSummary('Tests:       2 failed, 12 passed, 14 total');
  assert.deepEqual(summary, { total: 14, passed: 12, failed: 2 });
});

test('parses a clean-pass summary line', () => {
  const summary = parseJestSummary('Tests:       14 passed, 14 total');
  assert.deepEqual(summary, { total: 14, passed: 14, failed: 0 });
});

test('returns null when no summary line is present', () => {
  assert.equal(parseJestSummary('some unrelated output'), null);
});

test('evaluateRegressionResult: all passing -> PASSED', () => {
  const outcome = evaluateRegressionResult({
    stdout: '',
    stderr: 'Tests:       14 passed, 14 total',
    exitCode: 0,
    timedOut: false,
    durationMs: 100,
  });
  assert.equal(outcome.outcome, 'PASSED');
  assert.equal(outcome.total, 14);
  assert.equal(outcome.failed, 0);
});

test('evaluateRegressionResult: some failing -> FAILED', () => {
  const outcome = evaluateRegressionResult({
    stdout: '',
    stderr: 'Tests:       1 failed, 13 passed, 14 total',
    exitCode: 1,
    timedOut: false,
    durationMs: 100,
  });
  assert.equal(outcome.outcome, 'FAILED');
  assert.equal(outcome.failed, 1);
});

test('evaluateRegressionResult: timeout -> INFRA_ERROR', () => {
  const outcome = evaluateRegressionResult({ stdout: '', stderr: '', exitCode: null, timedOut: true, durationMs: 100 });
  assert.equal(outcome.outcome, 'INFRA_ERROR');
});

test('evaluateRegressionResult: no parsable summary -> INFRA_ERROR, not FAILED', () => {
  const outcome = evaluateRegressionResult({
    stdout: '',
    stderr: 'Cannot find module foo',
    exitCode: 1,
    timedOut: false,
    durationMs: 100,
  });
  assert.equal(outcome.outcome, 'INFRA_ERROR');
});

test('skippedRegressionResult: vacuously passes with zero tests', () => {
  const outcome = skippedRegressionResult();
  assert.equal(outcome.outcome, 'SKIPPED');
  assert.equal(outcome.total, 0);
});
