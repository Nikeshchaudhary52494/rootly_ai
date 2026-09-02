import { StateGraph, START, END } from '@langchain/langgraph';
import type { InvestigationLLM } from '../llm/llm.client';
import { InvestigationAnnotation, type InvestigationState } from './investigation.state';
import { loadContextNode } from './nodes/load-context.node';
import { createAnalyzeErrorNode } from './nodes/analyze-error.node';
import { createAnalyzeCodeNode } from './nodes/analyze-code.node';
import { createAnalyzeHistoryNode } from './nodes/analyze-history.node';
import { createGenerateHypothesesNode } from './nodes/generate-hypotheses.node';
import { createEvaluateEvidenceNode } from './nodes/evaluate-evidence.node';
import { createGenerateReportNode } from './nodes/generate-report.node';

const NODES = [
  'load_context',
  'analyze_error',
  'analyze_code',
  'analyze_history',
  'generate_hypotheses',
  'evaluate_evidence',
  'generate_report',
] as const;

/** After any node, stop the pipeline early if it already failed instead of paying for further LLM calls. */
function nextOrEnd(next: (typeof NODES)[number]) {
  return (state: InvestigationState) => (state.status === 'FAILED' ? END : next);
}

export function buildInvestigationGraph(llm: InvestigationLLM) {
  const graph = new StateGraph(InvestigationAnnotation)
    .addNode('load_context', loadContextNode)
    .addNode('analyze_error', createAnalyzeErrorNode(llm))
    .addNode('analyze_code', createAnalyzeCodeNode(llm))
    .addNode('analyze_history', createAnalyzeHistoryNode(llm))
    .addNode('generate_hypotheses', createGenerateHypothesesNode(llm))
    .addNode('evaluate_evidence', createEvaluateEvidenceNode(llm))
    .addNode('generate_report', createGenerateReportNode(llm))
    .addEdge(START, 'load_context')
    .addConditionalEdges('load_context', nextOrEnd('analyze_error'))
    .addConditionalEdges('analyze_error', nextOrEnd('analyze_code'))
    .addConditionalEdges('analyze_code', nextOrEnd('analyze_history'))
    .addConditionalEdges('analyze_history', nextOrEnd('generate_hypotheses'))
    .addConditionalEdges('generate_hypotheses', nextOrEnd('evaluate_evidence'))
    .addConditionalEdges('evaluate_evidence', nextOrEnd('generate_report'))
    .addEdge('generate_report', END);

  return graph.compile();
}
