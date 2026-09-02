import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePostFixValidationTest } from '../src/patch/post-fix-test-generator';
import { FakeLLM } from './fake-llm';
import { buildFixGenerationInput } from './fixtures';

const PROPOSAL = {
  summary: 'Guard against a missing customer before accessing .id.',
  rootCause: 'customer can be undefined.',
  changes: [
    {
      filePath: 'src/services/payment.service.js',
      startLine: 2,
      endLine: 2,
      originalCode: '  return payment.customer.id;',
      replacementCode: '  return payment.customer?.id ?? null;',
      explanation: 'Guard against a missing customer.',
    },
  ],
  patch: '',
  testsExpectedToPass: [],
  risks: [],
};

test('generates a valid post-fix validation test, forcing the same file path as the original reproduction test', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    filePath: 'some/other/path.spec.js', // the model's own choice — should be overridden
    content:
      "const { confirmPayment } = require('../src/services/payment.service');\ndescribe('x', () => {\n  it('no longer throws', () => {\n    expect(() => confirmPayment({ id: 'p1', customer: null })).not.toThrow();\n  });\n});\n",
    testName: 'no longer throws when customer is null',
    expectedBehavior: 'confirmPayment returns null instead of throwing when customer is missing.',
  }));

  const input = buildFixGenerationInput();
  const result = await generatePostFixValidationTest(input, PROPOSAL, { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.test?.filePath, input.reproduction.testFilePath); // forced, not the model's own path
});

test('retries once and recovers when the first test violates a safety rule', async () => {
  const dangerous = {
    filePath: 'x',
    content: "require('child_process').exec('ls');\ndescribe('x', () => { it('y', () => { expect(true).toBe(true); }); });",
    testName: 'x',
    expectedBehavior: 'x',
  };
  const safe = {
    filePath: 'x',
    content:
      "const { confirmPayment } = require('../src/services/payment.service');\ndescribe('x', () => {\n  it('no longer throws', () => {\n    expect(() => confirmPayment({ id: 'p1', customer: null })).not.toThrow();\n  });\n});\n",
    testName: 'x',
    expectedBehavior: 'x',
  };
  const llm = new FakeLLM().enqueueValid(() => dangerous).enqueueValid(() => safe);
  const result = await generatePostFixValidationTest(buildFixGenerationInput(), PROPOSAL, { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(llm.calls.length, 2);
});

test('fails cleanly when the test keeps violating safety rules after the retry', async () => {
  const dangerous = {
    filePath: 'x',
    content: "require('child_process').exec('ls');\ndescribe('x', () => { it('y', () => { expect(true).toBe(true); }); });",
    testName: 'x',
    expectedBehavior: 'x',
  };
  const llm = new FakeLLM().enqueueValid(() => dangerous).enqueueValid(() => dangerous);
  const result = await generatePostFixValidationTest(buildFixGenerationInput(), PROPOSAL, { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.test, null);
});
