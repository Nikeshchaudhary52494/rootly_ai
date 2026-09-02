import { systemPrompt } from './shared';
import type { FixProposal } from '../schemas/fix-proposal.schema';
import type { FixGenerationInput } from '../graph/fix-generation.state';

export function generatePostFixTestPrompt(input: FixGenerationInput, proposal: FixProposal) {
  const system = systemPrompt(
    'You are writing a Jest test that proves a bug is FIXED, not that it exists. The original reproduction ' +
      'test below asserted the failure happened; your job is to write the same kind of test — same target ' +
      'function, same realistic input that used to trigger the bug — but asserting the CORRECTED behavior ' +
      'now holds (e.g. it no longer throws, or it returns a safe value). Exercise the exact same code path ' +
      'as the original reproduction test.',
  );

  const user = [
    'Original reproduction test (this is what proved the bug — do not just invert one word, understand what ' +
      'it actually exercises):',
    `File: ${input.reproduction.testFilePath}`,
    '```',
    input.reproduction.generatedTest,
    '```',
    '',
    'The applied fix:',
    `Summary: ${proposal.summary}`,
    `Root cause addressed: ${proposal.rootCause}`,
    proposal.changes.map((c) => `- ${c.filePath} (lines ${c.startLine}-${c.endLine}): ${c.explanation}`).join('\n'),
    '',
    `Write one Jest test at the same path as the original reproduction test (${input.reproduction.testFilePath}) ` +
      'that imports the same module, constructs the same input that used to trigger the failure, and asserts ' +
      'the corrected behavior. No network calls, no filesystem access, no child_process, no reading ' +
      'process.env, no shell commands. Be fully deterministic.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
