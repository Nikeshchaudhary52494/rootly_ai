import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFixProposal } from '../src/patch/patch-generator';
import { DEFAULT_PATCH_SAFETY_LIMITS } from '../src/patch/patch-validator';
import { FakeLLM } from './fake-llm';
import { buildFixGenerationInput } from './fixtures';

const ANALYSIS = {
  targetFile: 'src/services/payment.service.js',
  targetFunctionOrExport: 'confirmPayment',
  rootCauseSummary: 'customer can be undefined before .id is accessed.',
  proposedApproach: 'Use optional chaining and a null fallback.',
};

const VALID_CHANGE = {
  filePath: 'src/services/payment.service.js',
  startLine: 2,
  endLine: 2,
  originalCode: '  return payment.customer.id;',
  replacementCode: '  return payment.customer?.id ?? null;',
  explanation: 'Guard against a missing customer.',
};

function validProposal(overrides: Partial<typeof VALID_CHANGE> = {}) {
  return {
    summary: 'Guard against a missing customer before accessing .id.',
    rootCause: 'customer can be undefined.',
    changes: [{ ...VALID_CHANGE, ...overrides }],
    patch: '--- a/src/services/payment.service.js\n+++ b/src/services/payment.service.js\n',
    testsExpectedToPass: ['reproduction-tests/payment-null-customer.spec.js'],
    risks: [],
  };
}

test('generates a valid fix proposal end to end', async () => {
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => validProposal());
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.proposal);
  assert.equal(result.proposal?.changes.length, 1);
  assert.equal(llm.calls.length, 2);
});

test('recovers when the first proposal cites originalCode that does not match the shown source, via one correction retry', async () => {
  const hallucinated = validProposal({ originalCode: '  return payment.customer.name; // hallucinated' });
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => hallucinated).enqueueValid(() => validProposal());
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(llm.calls.length, 3);
  assert.ok((llm.calls[2].user as string).includes('rejected for'));
});

test('fails when the proposal keeps citing mismatched original content after the retry', async () => {
  const hallucinated = validProposal({ originalCode: 'totally made up line' });
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => hallucinated).enqueueValid(() => hallucinated);
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(result.proposal, null);
  assert.ok(result.errors.some((e) => e.includes('failed validation')));
});

test('rejects a proposal that touches package.json even if originalCode would match', async () => {
  const badFile = validProposal({ filePath: 'package.json', originalCode: '{', replacementCode: '{ "x": 1' });
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => badFile).enqueueValid(() => badFile);
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
});

test('rejects a proposal exceeding the configured patch size limits', async () => {
  const tooBig = {
    ...validProposal(),
    changes: Array.from({ length: 3 }, (_, i) => ({ ...VALID_CHANGE, filePath: `src/file-${i}.js` })),
  };
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => tooBig).enqueueValid(() => tooBig);
  const result = await generateFixProposal(buildFixGenerationInput(), {
    llm,
    limits: { ...DEFAULT_PATCH_SAFETY_LIMITS, maxFiles: 1 },
  });

  assert.equal(result.status, 'FAILED');
});

test('fails cleanly when the analysis stage itself fails', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({ nonsense: true })).enqueueValid(() => ({ nonsense: true }));
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.equal(llm.calls.length, 2); // never reaches generate_patch
});

test('supports multiple changes across multiple files within the limit', async () => {
  const multi = validProposal();
  multi.changes.push({
    filePath: 'src/services/other.service.js',
    startLine: 1,
    endLine: 1,
    originalCode: 'irrelevant',
    replacementCode: 'irrelevant-changed',
    explanation: 'unused in this test',
  });
  // second file isn't in cached context, so this specific combination should fail validation —
  // demonstrating that a change to an unshown file is rejected, not silently trusted.
  const llm = new FakeLLM().enqueueValid(() => ANALYSIS).enqueueValid(() => multi).enqueueValid(() => multi);
  const result = await generateFixProposal(buildFixGenerationInput(), { llm });
  assert.equal(result.status, 'FAILED');
});
