import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBeforeFixReproduction, evaluatePostFixValidation } from '../src/validation/reproduction-validator';

test('before-fix: exit 0 -> REPRODUCED', () => {
  const outcome = evaluateBeforeFixReproduction({ exitCode: 0, stdout: 'PASS', stderr: '', timedOut: false, durationMs: 1 });
  assert.equal(outcome.result, 'REPRODUCED');
});

test('before-fix: clean non-zero exit -> NOT_REPRODUCED', () => {
  const outcome = evaluateBeforeFixReproduction({ exitCode: 1, stdout: 'FAIL', stderr: '', timedOut: false, durationMs: 1 });
  assert.equal(outcome.result, 'NOT_REPRODUCED');
});

test('before-fix: infra failure -> INCONCLUSIVE', () => {
  const outcome = evaluateBeforeFixReproduction({ exitCode: 1, stdout: '', stderr: 'Cannot find module', timedOut: false, durationMs: 1 });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('post-fix: exit 0 -> PASSED (bug no longer occurs)', () => {
  const outcome = evaluatePostFixValidation({ exitCode: 0, stdout: 'PASS', stderr: '', timedOut: false, durationMs: 1 });
  assert.equal(outcome.outcome, 'PASSED');
});

test('post-fix: clean non-zero exit -> FAILED (bug still occurs)', () => {
  const outcome = evaluatePostFixValidation({ exitCode: 1, stdout: 'FAIL', stderr: '', timedOut: false, durationMs: 1 });
  assert.equal(outcome.outcome, 'FAILED');
});

test('post-fix: missing module -> INFRA_ERROR, not FAILED', () => {
  const outcome = evaluatePostFixValidation({
    exitCode: 1,
    stdout: '',
    stderr: "Cannot find module '../src/services/payment.service'",
    timedOut: false,
    durationMs: 1,
  });
  assert.equal(outcome.outcome, 'INFRA_ERROR');
});

test('post-fix: timeout -> INFRA_ERROR', () => {
  const outcome = evaluatePostFixValidation({ exitCode: null, stdout: '', stderr: '', timedOut: true, durationMs: 1 });
  assert.equal(outcome.outcome, 'INFRA_ERROR');
});
