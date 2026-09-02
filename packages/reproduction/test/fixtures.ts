import type { TestGenerationInput } from '../src/graph/generation.state';

export function buildGenerationInput(overrides: Partial<TestGenerationInput> = {}): TestGenerationInput {
  return {
    incident: { errorName: 'TypeError', errorMessage: "Cannot read properties of null (reading 'id')", occurrenceCount: 12 },
    latestEvent: {
      errorMessage: "Cannot read properties of null (reading 'id')",
      stackTrace: 'TypeError: x\n    at confirmPayment (src/services/payment.service.js:2:12)',
    },
    investigation: {
      summary: 'PaymentService accesses customer.id without validating customer.',
      rootCause: 'The payment confirmation path assumes customer is always present.',
      recommendation: 'Validate customer before accessing customer.id.',
      confidence: 0.91,
      hypotheses: [{ title: 'Missing customer validation', description: 'd', confidence: 0.91, status: 'LIKELY' }],
    },
    codeContext: {
      primaryFilePath: 'src/services/payment.service.js',
      primaryLineNumber: 2,
      files: [
        {
          filePath: 'src/services/payment.service.js',
          functionName: 'confirmPayment',
          content: 'function confirmPayment(payment) {\n  return payment.customer.id;\n}\n\nmodule.exports = { confirmPayment };',
          contentStartLine: 1,
          contentEndLine: 5,
        },
      ],
      relatedTests: [],
    },
    packageJsonContent: null,
    ...overrides,
  };
}
