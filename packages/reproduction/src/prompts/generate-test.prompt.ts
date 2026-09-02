import { systemPrompt } from './shared';
import { REPRODUCTION_TEST_DIR } from '../test/test-validator';
import type { FailureUnderstanding } from '../schemas/failure-understanding.schema';
import type { TestGenerationInput } from '../graph/generation.state';

export function generateTestPrompt(input: TestGenerationInput, understanding: FailureUnderstanding) {
  const system = systemPrompt(
    'You are a senior software engineer writing a single Jest test that reproduces a known production ' +
      'failure. The test must import the real module from the repository and exercise the real failure ' +
      'condition — do not mock away the function under test.',
  );

  const relatedTests = input.codeContext.relatedTests
    .map((t) => `File: ${t.filePath}\n\`\`\`\n${t.content}\n\`\`\``)
    .join('\n\n');

  const user = [
    'What must be reproduced:',
    JSON.stringify(understanding, null, 2),
    '',
    input.packageJsonContent ? `package.json:\n\`\`\`json\n${input.packageJsonContent}\n\`\`\`` : null,
    '',
    relatedTests ? `Existing tests in this repository (match their import/module style):\n\n${relatedTests}` : null,
    '',
    `Write one Jest test file. Requirements:`,
    `- filePath must start with "${REPRODUCTION_TEST_DIR}" and end in .test.js, .test.ts, .spec.js, or .spec.ts.`,
    '- Match the module system already used by the repository (require/module.exports if the existing code is CommonJS).',
    '- Import the real target file using a relative path from the test file to the repository root shown in its filePath.',
    '- Use realistic input values, construct the exact failure condition identified above, and assert the expected failure (e.g. expect(() => fn(...)).toThrow(...)) — a passing test must mean the bug reproduced, not merely that code ran.',
    '- Do not modify or redefine the function under test — only import and call it.',
    '- No network calls, no filesystem access, no child_process, no reading process.env, no shell commands.',
    '- Be fully deterministic: no randomness, no timers, no real dates.',
    'Also provide a short, plain-language explanation of why this test should reproduce the bug.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
