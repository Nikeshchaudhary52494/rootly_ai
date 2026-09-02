import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePullRequestContent } from '../src/pull-request/pull-request-manager';

function baseInput() {
  return {
    incidentSequenceNumber: 42,
    errorName: 'TypeError',
    errorMessage: "Cannot read properties of undefined (reading 'id')",
    rootCause: 'PaymentService accesses customer.id without validating customer.',
    targetCommitSha: 'abc123',
    fixExplanation: 'Guard against a missing customer using optional chaining.',
    changedFiles: ['demo-app/src/services/payment.service.js'],
    regressionTestsRan: true,
  };
}

test('generatePullRequestContent: title is derived from the fix explanation', () => {
  const { title } = generatePullRequestContent(baseInput());
  assert.equal(title, 'fix: Guard against a missing customer using optional chaining');
});

test('generatePullRequestContent: falls back to the error name with no fix explanation', () => {
  const { title } = generatePullRequestContent({ ...baseInput(), fixExplanation: null });
  assert.equal(title, 'fix: handle TypeError');
});

test('generatePullRequestContent: body includes incident number, root cause, target commit, and changed files', () => {
  const { body } = generatePullRequestContent(baseInput());
  assert.match(body, /Incident #42/);
  assert.match(body, /PaymentService accesses customer\.id/);
  assert.match(body, /abc123/);
  assert.match(body, /demo-app\/src\/services\/payment\.service\.js/);
  assert.match(body, /Generated and validated by rootly.ai/);
});

test('generatePullRequestContent: body never includes stdout/stderr-style giant logs', () => {
  const { body } = generatePullRequestContent(baseInput());
  assert.ok(body.length < 3000);
  assert.doesNotMatch(body, /PASS |FAIL |at Object\./);
});

test('generatePullRequestContent: title is truncated to a reasonable length', () => {
  const { title } = generatePullRequestContent({ ...baseInput(), fixExplanation: 'x'.repeat(300) });
  assert.ok(title.length <= 100);
});

test('generatePullRequestContent: reports when no regression tests were found', () => {
  const { body } = generatePullRequestContent({ ...baseInput(), regressionTestsRan: false });
  assert.match(body, /No related regression tests were found/);
});
