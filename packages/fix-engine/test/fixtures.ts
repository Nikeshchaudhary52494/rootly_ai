import type { FixGenerationInput } from '../src/graph/fix-generation.state';

export function buildFixGenerationInput(overrides: Partial<FixGenerationInput> = {}): FixGenerationInput {
  const primaryContent = ['function confirmPayment(payment) {', '  return payment.customer.id;', '}', '', 'module.exports = { confirmPayment };', ''].join(
    '\n',
  );

  return {
    incident: {
      errorName: 'TypeError',
      errorMessage: "Cannot read properties of undefined (reading 'id')",
      stackTrace: 'TypeError: x\n    at confirmPayment (src/services/payment.service.js:2:14)',
    },
    investigation: {
      rootCause: 'The payment confirmation path assumes customer is always present.',
      confidence: 0.91,
      recommendation: 'Validate customer before accessing customer.id.',
      evidenceDescriptions: ['customer.id is accessed without checking that customer is defined'],
    },
    reproduction: {
      generatedTest:
        "const { confirmPayment } = require('../src/services/payment.service');\ndescribe('x', () => {\n  it('throws', () => {\n    expect(() => confirmPayment({ id: 'p1', customer: null })).toThrow();\n  });\n});\n",
      testFilePath: 'reproduction-tests/payment-null-customer.spec.js',
      result: 'REPRODUCED',
      stdout: 'PASS reproduction-tests/payment-null-customer.spec.js',
      stderr: '',
    },
    codeContext: {
      primaryFilePath: 'src/services/payment.service.js',
      primaryLineNumber: 2,
      files: [
        {
          filePath: 'src/services/payment.service.js',
          functionName: 'confirmPayment',
          content: primaryContent,
          contentStartLine: 1,
          contentEndLine: 6,
        },
      ],
      relatedTests: [],
      recentCommits: [],
    },
    ...overrides,
  };
}
