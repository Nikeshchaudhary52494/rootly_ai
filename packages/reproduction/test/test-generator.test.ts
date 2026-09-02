import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateReproductionTest } from '../src/test/test-generator';
import { FakeLLM } from './fake-llm';
import { buildGenerationInput } from './fixtures';

const UNDERSTANDING = {
  targetFile: 'src/services/payment.service.js',
  targetFunctionOrExport: 'confirmPayment',
  failureCondition: 'payment.customer is null',
  expectedFailureType: 'TypeError',
  reproductionApproach: 'Call confirmPayment with a payment whose customer is null and expect it to throw.',
};

const VALID_TEST = {
  filePath: 'reproduction-tests/payment.spec.js',
  testName: 'reproduces crash when payment has no customer',
  language: 'javascript',
  framework: 'jest',
  content:
    "const { confirmPayment } = require('../src/services/payment.service');\ndescribe('payment reproduction', () => {\n  it('throws when customer is null', () => {\n    expect(() => confirmPayment({ id: 'p1', customer: null })).toThrow();\n  });\n});",
  explanation: 'customer is null so payment.customer.id throws a TypeError.',
};

test('generates a valid test end to end', async () => {
  const llm = new FakeLLM().enqueueValid(() => UNDERSTANDING).enqueueValid(() => VALID_TEST);
  const result = await generateReproductionTest(buildGenerationInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.test);
  assert.equal(result.test?.filePath, 'reproduction-tests/payment.spec.js');
  assert.equal(llm.calls.length, 2);
});

test('recovers when the first generated test violates the path rule, via one correction retry', async () => {
  const invalidPathTest = { ...VALID_TEST, filePath: 'src/payment.spec.js' };
  const llm = new FakeLLM()
    .enqueueValid(() => UNDERSTANDING)
    .enqueueValid(() => invalidPathTest) // rejected by validateGeneratedTest
    .enqueueValid(() => VALID_TEST); // corrected
  const result = await generateReproductionTest(buildGenerationInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.test?.filePath, 'reproduction-tests/payment.spec.js');
  assert.equal(llm.calls.length, 3);
  // the correction attempt's prompt should explain what was wrong
  assert.ok(llm.calls[2].user.includes('rejected for'));
});

test('fails when the generated test keeps violating safety rules after the retry', async () => {
  const dangerousTest = { ...VALID_TEST, content: `${VALID_TEST.content}\nrequire('child_process').exec('ls');` };
  const llm = new FakeLLM().enqueueValid(() => UNDERSTANDING).enqueueValid(() => dangerousTest).enqueueValid(() => dangerousTest);
  const result = await generateReproductionTest(buildGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.test, null);
  assert.ok(result.errors.some((e) => e.includes('failed validation')));
});

test('fails cleanly when the model never returns valid structured output', async () => {
  const llm = new FakeLLM()
    .enqueueValid(() => UNDERSTANDING)
    .enqueueValid(() => ({ nonsense: true }))
    .enqueueValid(() => ({ nonsense: true }));
  const result = await generateReproductionTest(buildGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.test, null);
});

test('fails cleanly when the understanding stage itself fails', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({ nonsense: true })).enqueueValid(() => ({ nonsense: true }));
  const result = await generateReproductionTest(buildGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(llm.calls.length, 2); // never reaches generate_test
});
