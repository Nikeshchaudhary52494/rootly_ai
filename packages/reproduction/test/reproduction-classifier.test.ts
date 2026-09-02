import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReproduction } from '../src/reproduction/reproduction-classifier';

test('exit code 0 -> REPRODUCED', () => {
  const outcome = classifyReproduction({
    exitCode: 0,
    stdout: 'PASS reproduction-tests/x.spec.js\nTests: 1 passed, 1 total',
    stderr: '',
    timedOut: false,
  });
  assert.equal(outcome.result, 'REPRODUCED');
});

test('exit code 1 with a clean test run -> NOT_REPRODUCED', () => {
  const outcome = classifyReproduction({
    exitCode: 1,
    stdout: 'FAIL reproduction-tests/x.spec.js\nTests: 1 failed, 1 total',
    stderr: 'Expected the function to throw, but it did not.',
    timedOut: false,
  });
  assert.equal(outcome.result, 'NOT_REPRODUCED');
});

test('missing module -> INCONCLUSIVE, not NOT_REPRODUCED', () => {
  const outcome = classifyReproduction({
    exitCode: 1,
    stdout: '',
    stderr: "Cannot find module '../src/services/payment.service' from 'reproduction-tests/x.spec.js'",
    timedOut: false,
  });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('syntax error in the generated test -> INCONCLUSIVE', () => {
  const outcome = classifyReproduction({
    exitCode: 1,
    stdout: '',
    stderr: 'SyntaxError: Unexpected token )',
    timedOut: false,
  });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('timeout -> INCONCLUSIVE regardless of exit code', () => {
  const outcome = classifyReproduction({ exitCode: 0, stdout: '', stderr: '', timedOut: true });
  assert.equal(outcome.result, 'INCONCLUSIVE');
  assert.match(outcome.reason, /timed out/i);
});

test('null exit code (process never reported) -> INCONCLUSIVE', () => {
  const outcome = classifyReproduction({ exitCode: null, stdout: '', stderr: '', timedOut: false });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});

test('npm ERR! noise counts as an infra failure signature', () => {
  const outcome = classifyReproduction({
    exitCode: 1,
    stdout: '',
    stderr: 'npm ERR! code ENOTFOUND\nnpm ERR! network request failed',
    timedOut: false,
  });
  assert.equal(outcome.result, 'INCONCLUSIVE');
});
