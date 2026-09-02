import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInvestigation } from '../src/index';
import { FakeLLM } from './fake-llm';
import { buildInput } from './fixtures';

function enqueueHappyPath(llm: FakeLLM, confidence = 0.91) {
  llm
    .enqueueValid(() => ({
      errorType: 'TypeError',
      normalizedMessage: "Cannot read properties of undefined (reading 'id')",
      primaryLocation: { file: 'src/services/payment.service.js', line: 2 },
      observations: ['payment.customer is undefined when accessed'],
    }))
    .enqueueValid(() => ({
      observations: [
        {
          description: 'customer.id is accessed without checking that customer is defined',
          sourceFile: 'src/services/payment.service.js',
          lineStart: 2,
          lineEnd: 2,
        },
      ],
    }))
    .enqueueValid(() => ({
      observations: [{ commitSha: 'abc123', description: 'changed customer validation behavior', relevance: 0.6 }],
    }))
    .enqueueValid(() => ({
      hypotheses: [
        { title: 'Missing customer validation', description: 'PaymentService assumes customer always exists.', confidence: 0.85 },
      ],
    }))
    .enqueueValid(() => ({
      evaluations: [
        {
          hypothesisIndex: 0,
          supportingEvidenceIds: ['error-message', 'stack-trace-location', 'code-0'],
          contradictingEvidenceIds: [],
          missingEvidence: ['Whether the API contract guarantees a customer is present.'],
          revisedConfidence: confidence,
          status: 'LIKELY',
        },
      ],
    }))
    .enqueueValid(() => ({
      summary: 'PaymentService accesses customer.id without validating customer.',
      rootCause: 'The payment confirmation path assumes customer is always present.',
      impact: 'Requests containing a payment without a customer fail with TypeError.',
      recommendation: 'Validate customer before accessing customer.id.',
    }));
  return llm;
}

test('runInvestigation: completes the full pipeline and grounds evidence in real context', async () => {
  const llm = enqueueHappyPath(new FakeLLM());
  const result = await runInvestigation('inv-1', 'incident-1', buildInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.hypotheses[0].status, 'LIKELY');
  assert.equal(result.hypotheses[0].rank, 1);
  assert.equal(result.hypotheses[0].confidence, 0.91);
  assert.equal(result.hypotheses[0].supportingEvidence.length, 3);
  assert.ok(result.hypotheses[0].supportingEvidence.some((e) => e.sourceReference === 'src/services/payment.service.js'));

  assert.equal(result.finalConfidence, 0.91);
  assert.equal(result.finalReport?.confidence, 0.91);
  assert.equal(result.finalReport?.affectedComponent, 'payment-service');
  assert.equal(result.finalReport?.primaryLocation?.file, 'src/services/payment.service.js');
  assert.equal(result.finalReport?.primaryLocation?.line, 2);
  assert.doesNotMatch(result.finalReport?.recommendation ?? '', /```/);

  assert.equal(llm.calls.length, 6);
  assert.ok(result.usage.totalTokens > 0);
});

test('runInvestigation: fails fast with a clear message when no code context exists, without calling the LLM', async () => {
  const llm = new FakeLLM();
  const result = await runInvestigation('inv-2', 'incident-2', buildInput({ codeContext: null }), { llm });

  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.errors, ['Code context has not been collected for this incident.']);
  assert.equal(llm.calls.length, 0);
});

test('runInvestigation: a hypothesis with multiple candidates keeps the highest-confidence one first', async () => {
  const llm = new FakeLLM()
    .enqueueValid(() => ({
      errorType: 'TypeError',
      normalizedMessage: 'x',
      primaryLocation: { file: 'src/services/payment.service.js', line: 2 },
      observations: [],
    }))
    .enqueueValid(() => ({ observations: [] }))
    .enqueueValid(() => ({ observations: [] }))
    .enqueueValid(() => ({
      hypotheses: [
        { title: 'Missing customer validation', description: 'd1', confidence: 0.6 },
        { title: 'API contract changed', description: 'd2', confidence: 0.4 },
        { title: 'Incomplete database response', description: 'd3', confidence: 0.2 },
      ],
    }))
    .enqueueValid(() => ({
      evaluations: [
        { hypothesisIndex: 0, supportingEvidenceIds: ['error-message'], contradictingEvidenceIds: [], missingEvidence: [], revisedConfidence: 0.91, status: 'LIKELY' },
        { hypothesisIndex: 1, supportingEvidenceIds: [], contradictingEvidenceIds: [], missingEvidence: [], revisedConfidence: 0.72, status: 'POSSIBLE' },
        { hypothesisIndex: 2, supportingEvidenceIds: [], contradictingEvidenceIds: [], missingEvidence: [], revisedConfidence: 0.31, status: 'REJECTED' },
      ],
    }))
    .enqueueValid(() => ({
      summary: 's',
      rootCause: 'r',
      impact: 'i',
      recommendation: 'rec',
    }));

  const result = await runInvestigation('inv-3', 'incident-3', buildInput(), { llm });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.hypotheses.length, 3);
  assert.deepEqual(
    result.hypotheses.map((h) => h.rank),
    [1, 2, 3],
  );
  assert.deepEqual(
    result.hypotheses.map((h) => h.status),
    ['LIKELY', 'POSSIBLE', 'REJECTED'],
  );
  assert.equal(result.finalConfidence, 0.91);
});

test('runInvestigation: an out-of-range confidence value fails schema validation and the run fails after retry', async () => {
  const llm = new FakeLLM()
    .enqueueValid(() => ({
      errorType: 'TypeError',
      normalizedMessage: 'x',
      primaryLocation: null,
      observations: [],
    }))
    .enqueueValid(() => ({ observations: [] }))
    .enqueueValid(() => ({ observations: [] }))
    // confidence 1.4 is out of the schema's 0..1 bound on both attempts
    .enqueueValid(() => ({ hypotheses: [{ title: 'H', description: 'd', confidence: 1.4 }] }))
    .enqueueValid(() => ({ hypotheses: [{ title: 'H', description: 'd', confidence: 1.4 }] }));

  const result = await runInvestigation('inv-4', 'incident-4', buildInput(), { llm });

  assert.equal(result.status, 'FAILED');
  assert.ok(result.errors.some((e) => e.includes('Structured output validation failed after retry')));
  assert.equal(llm.calls.length, 5); // 3 successful analysis calls + 2 failed hypothesis attempts
});

test('runInvestigation: an unexpected LLM exception surfaces as FAILED, never throws', async () => {
  const llm = new FakeLLM(); // no responses queued at all -> first call throws
  const result = await runInvestigation('inv-5', 'incident-5', buildInput(), { llm });
  assert.equal(result.status, 'FAILED');
  assert.ok(result.errors.length > 0);
});
