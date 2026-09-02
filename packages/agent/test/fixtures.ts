import type { InvestigationInput, InvestigationState } from '../src/graph/investigation.state';

export function buildInput(overrides: Partial<InvestigationInput> = {}): InvestigationInput {
  const primaryContent = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`)
    .map((line, i) => (i === 1 ? '  return payment.customer.id;' : line))
    .join('\n');

  return {
    incident: {
      id: 'incident-1',
      title: 'TypeError: Cannot read properties of undefined',
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'id')",
      status: 'OPEN',
      occurrenceCount: 12,
    },
    latestEvent: {
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'id')",
      stackTrace:
        "TypeError: Cannot read properties of undefined (reading 'id')\n    at confirmPayment (src/services/payment.service.js:2:27)",
      serviceName: 'payment-service',
      environmentName: 'production',
      release: '1.0.0',
      timestamp: '2026-01-01T00:00:00.000Z',
    },
    codeContext: {
      status: 'READY',
      primaryLocation: { filePath: 'src/services/payment.service.js', lineNumber: 2 },
      files: [
        {
          filePath: 'src/services/payment.service.js',
          functionName: 'confirmPayment',
          lineNumber: 2,
          contentStartLine: 1,
          contentEndLine: 100,
          content: primaryContent,
          isPrimary: true,
        },
      ],
      relatedTests: [
        {
          filePath: 'src/services/payment.service.spec.js',
          content: 'test("processes a valid payment", () => {\n  confirmPayment({ customer: { id: "c1" } });\n});',
        },
      ],
      recentCommits: [
        {
          sha: 'abc123',
          message: 'refactor payment validation',
          authorName: 'Jane Doe',
          committedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
    repository: { owner: 'acme', name: 'payment-service', defaultBranch: 'main' },
    ...overrides,
  };
}

/** Fills in every InvestigationState field with a harmless default so node unit tests only override what they need. */
export function baseState(overrides: Partial<InvestigationState> = {}): InvestigationState {
  return {
    investigationId: 'inv-1',
    incidentId: 'incident-1',
    input: buildInput(),
    evidencePool: [],
    errorAnalysis: null,
    codeAnalysis: null,
    historyAnalysis: null,
    hypotheses: [],
    finalReport: null,
    status: 'RUNNING',
    errors: [],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    ...overrides,
  };
}
