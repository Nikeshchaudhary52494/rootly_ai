import type { ErrorAnalysis, CodeAnalysis, HistoryAnalysis, EvidenceCandidate } from '../schemas/investigation.schema';

/**
 * Builds the fixed set of citable evidence for this investigation. Every
 * candidate here was already validated (or is derived from ground truth) by
 * the node that produced its source analysis — later nodes only ever pick
 * ids from this pool, never restate a file/line/commit themselves.
 */
export function buildEvidencePool(
  errorAnalysis: ErrorAnalysis,
  codeAnalysis: CodeAnalysis,
  historyAnalysis: HistoryAnalysis,
): EvidenceCandidate[] {
  const pool: EvidenceCandidate[] = [
    {
      id: 'error-message',
      type: 'ERROR',
      description: `${errorAnalysis.errorType}: ${errorAnalysis.normalizedMessage}`,
      sourceReference: 'error',
      lineStart: null,
      lineEnd: null,
    },
  ];

  if (errorAnalysis.primaryLocation) {
    pool.push({
      id: 'stack-trace-location',
      type: 'STACK_TRACE',
      description: `Stack trace points to ${errorAnalysis.primaryLocation.file}:${errorAnalysis.primaryLocation.line}`,
      sourceReference: errorAnalysis.primaryLocation.file,
      lineStart: errorAnalysis.primaryLocation.line,
      lineEnd: errorAnalysis.primaryLocation.line,
    });
  }

  codeAnalysis.observations.forEach((obs, i) => {
    pool.push({
      id: `code-${i}`,
      type: obs.sourceFile.includes('.test.') || obs.sourceFile.includes('.spec.') || obs.sourceFile.includes('test') ? 'TEST' : 'SOURCE_CODE',
      description: obs.description,
      sourceReference: obs.sourceFile,
      lineStart: obs.lineStart,
      lineEnd: obs.lineEnd,
    });
  });

  historyAnalysis.observations.forEach((obs, i) => {
    pool.push({
      id: `history-${i}`,
      type: 'GIT_COMMIT',
      description: `${obs.description} (relevance ${obs.relevance})`,
      sourceReference: obs.commitSha,
      lineStart: null,
      lineEnd: null,
    });
  });

  return pool;
}
