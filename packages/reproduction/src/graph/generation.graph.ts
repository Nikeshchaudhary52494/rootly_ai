import { StateGraph, START, END } from '@langchain/langgraph';
import type { InvestigationLLM } from '@rootly.ai/agent';
import { TestGenerationAnnotation, type TestGenerationState } from './generation.state';
import { createUnderstandFailureNode } from './nodes/understand-failure.node';
import { createGenerateTestNode } from './nodes/generate-test.node';

function nextOrEnd(next: 'generate_test') {
  return (state: TestGenerationState) => (state.status === 'FAILED' ? END : next);
}

/**
 * UNDERSTAND_FAILURE -> GENERATE_TEST. Deliberately two LLM calls, not one —
 * forcing the model to name the exact file/function/condition before it
 * writes code measurably reduces hallucinated tests (mirrors the multi-stage
 * investigation graph in packages/agent).
 */
export function buildTestGenerationGraph(llm: InvestigationLLM) {
  const graph = new StateGraph(TestGenerationAnnotation)
    .addNode('understand_failure', createUnderstandFailureNode(llm))
    .addNode('generate_test', createGenerateTestNode(llm))
    .addEdge(START, 'understand_failure')
    .addConditionalEdges('understand_failure', nextOrEnd('generate_test'))
    .addEdge('generate_test', END);

  return graph.compile();
}
