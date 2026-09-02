import { StateGraph, START, END } from '@langchain/langgraph';
import type { InvestigationLLM } from '@rootly.ai/agent';
import type { PatchSafetyLimits } from '../patch/patch-validator';
import { DEFAULT_PATCH_SAFETY_LIMITS } from '../patch/patch-validator';
import { FixGenerationAnnotation, type FixGenerationState } from './fix-generation.state';
import { createAnalyzeFixNode } from './nodes/analyze-fix.node';
import { createGeneratePatchNode } from './nodes/generate-patch.node';

function nextOrEnd(next: 'generate_patch') {
  return (state: FixGenerationState) => (state.status === 'FAILED' ? END : next);
}

/**
 * ANALYZE_FIX -> GENERATE_PATCH. Two LLM calls, not one — the model names
 * the exact file/function/approach before it writes any code, the same
 * anti-hallucination shape as the investigation and reproduction graphs.
 */
export function buildFixGenerationGraph(llm: InvestigationLLM, limits: PatchSafetyLimits = DEFAULT_PATCH_SAFETY_LIMITS) {
  const graph = new StateGraph(FixGenerationAnnotation)
    .addNode('analyze_fix', createAnalyzeFixNode(llm))
    .addNode('generate_patch', createGeneratePatchNode(llm, limits))
    .addEdge(START, 'analyze_fix')
    .addConditionalEdges('analyze_fix', nextOrEnd('generate_patch'))
    .addEdge('generate_patch', END);

  return graph.compile();
}
