import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalyzeCodeNode } from '../src/graph/nodes/analyze-code.node';
import { createAnalyzeHistoryNode } from '../src/graph/nodes/analyze-history.node';
import { createEvaluateEvidenceNode } from '../src/graph/nodes/evaluate-evidence.node';
import { loadContextNode } from '../src/graph/nodes/load-context.node';
import { FakeLLM } from './fake-llm';
import { baseState, buildInput } from './fixtures';

const ERROR_ANALYSIS = {
  errorType: 'TypeError',
  normalizedMessage: "Cannot read properties of undefined (reading 'id')",
  primaryLocation: { file: 'src/services/payment.service.js', line: 2 },
  observations: ['payment.customer is undefined'],
};

test('load-context: fails with a clear message when no code context was collected', async () => {
  const update = loadContextNode({ input: buildInput({ codeContext: null }) });
  assert.equal(update.status, 'FAILED');
  assert.deepEqual(update.errors, ['Code context has not been collected for this incident.']);
});

test('load-context: fails when code context status is not READY', async () => {
  const input = buildInput();
  const update = loadContextNode({ input: { ...input, codeContext: { ...input.codeContext!, status: 'FAILED' } } });
  assert.equal(update.status, 'FAILED');
});

test('analyze-code: drops an observation that references a file not in the supplied context (hallucinated file)', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    observations: [
      { description: 'looks suspicious', sourceFile: 'src/services/imaginary.service.js', lineStart: 5, lineEnd: 5 },
    ],
  }));
  const node = createAnalyzeCodeNode(llm);
  const update = await node(baseState({ errorAnalysis: ERROR_ANALYSIS }));

  assert.deepEqual(update.codeAnalysis?.observations, []);
  assert.equal(update.status, 'ANALYZING_HISTORY');
  assert.ok(update.errors?.[0]?.includes('Dropped 1 code observation'));
});

test('analyze-code: drops an observation whose line number falls outside the supplied file range (hallucinated line)', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    observations: [
      { description: 'out of range', sourceFile: 'src/services/payment.service.js', lineStart: 9999, lineEnd: 9999 },
    ],
  }));
  const node = createAnalyzeCodeNode(llm);
  const update = await node(baseState({ errorAnalysis: ERROR_ANALYSIS }));

  assert.deepEqual(update.codeAnalysis?.observations, []);
  assert.ok(update.errors?.[0]?.includes('Dropped 1 code observation'));
});

test('analyze-code: keeps an observation that correctly cites the supplied file and line', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    observations: [
      { description: 'accesses customer.id without a null check', sourceFile: 'src/services/payment.service.js', lineStart: 2, lineEnd: 2 },
    ],
  }));
  const node = createAnalyzeCodeNode(llm);
  const update = await node(baseState({ errorAnalysis: ERROR_ANALYSIS }));

  assert.equal(update.codeAnalysis?.observations.length, 1);
  assert.equal(update.errors?.length ?? 0, 0);
});

test('analyze-history: drops an observation citing a commit sha that was never supplied (hallucinated commit)', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    observations: [{ commitSha: 'deadbeef', description: 'made up commit', relevance: 0.9 }],
  }));
  const node = createAnalyzeHistoryNode(llm);
  const update = await node(baseState({ errorAnalysis: ERROR_ANALYSIS, codeAnalysis: { observations: [] } }));

  assert.deepEqual(update.historyAnalysis?.observations, []);
  assert.ok(update.errors?.[0]?.includes('Dropped 1 history observation'));
});

test('evaluate-evidence: rejects an evidence id the model invented that is not in the pool', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    evaluations: [
      {
        hypothesisIndex: 0,
        supportingEvidenceIds: ['error-message', 'made-up-id'],
        contradictingEvidenceIds: [],
        missingEvidence: [],
        revisedConfidence: 0.8,
        status: 'LIKELY',
      },
    ],
  }));
  const node = createEvaluateEvidenceNode(llm);
  const update = await node(
    baseState({
      hypotheses: [
        { title: 'H1', description: 'd', confidence: 0.7, status: 'POSSIBLE', rank: 1, supportingEvidence: [], contradictingEvidence: [] },
      ],
      evidencePool: [
        { id: 'error-message', type: 'ERROR', description: 'the error', sourceReference: 'error', lineStart: null, lineEnd: null },
      ],
    }),
  );

  const evaluated = update.hypotheses?.[0];
  assert.equal(evaluated?.supportingEvidence.length, 1);
  assert.equal(evaluated?.supportingEvidence[0].sourceReference, 'error');
  assert.ok(update.errors?.[0]?.includes('Dropped 1 evidence citation'));
});

test('evaluate-evidence: ranks hypotheses by revised confidence, highest first', async () => {
  const llm = new FakeLLM().enqueueValid(() => ({
    evaluations: [
      { hypothesisIndex: 0, supportingEvidenceIds: [], contradictingEvidenceIds: [], missingEvidence: [], revisedConfidence: 0.4, status: 'POSSIBLE' },
      { hypothesisIndex: 1, supportingEvidenceIds: [], contradictingEvidenceIds: [], missingEvidence: [], revisedConfidence: 0.9, status: 'LIKELY' },
    ],
  }));
  const node = createEvaluateEvidenceNode(llm);
  const update = await node(
    baseState({
      hypotheses: [
        { title: 'Low', description: 'd', confidence: 0.4, status: 'POSSIBLE', rank: 1, supportingEvidence: [], contradictingEvidence: [] },
        { title: 'High', description: 'd', confidence: 0.9, status: 'POSSIBLE', rank: 2, supportingEvidence: [], contradictingEvidence: [] },
      ],
      evidencePool: [],
    }),
  );

  assert.equal(update.hypotheses?.[0].title, 'High');
  assert.equal(update.hypotheses?.[0].rank, 1);
  assert.equal(update.hypotheses?.[1].title, 'Low');
  assert.equal(update.hypotheses?.[1].rank, 2);
});
