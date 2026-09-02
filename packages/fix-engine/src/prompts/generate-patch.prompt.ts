import { systemPrompt } from './shared';
import type { FixAnalysis } from '../schemas/fix-analysis.schema';
import type { FixGenerationInput } from '../graph/fix-generation.state';

export function generatePatchPrompt(input: FixGenerationInput, analysis: FixAnalysis) {
  const system = systemPrompt(
    'You are a senior software engineer writing the actual patch for a confirmed bug. Every "originalCode" ' +
      'value must be an exact, verbatim copy of the corresponding lines from the source shown to you — it ' +
      'will be mechanically compared against the real file and rejected if it does not match character for ' +
      'character. Line numbers must be exactly correct for the file as shown.',
  );

  const relatedTests = input.codeContext.relatedTests
    .map((t) => `File: ${t.filePath}\n\`\`\`\n${t.content}\n\`\`\``)
    .join('\n\n');

  const user = [
    'What must change:',
    JSON.stringify(analysis, null, 2),
    '',
    relatedTests ? `Existing tests for this code (do not modify these):\n\n${relatedTests}` : null,
    '',
    'Produce a fix proposal: a short summary, the root cause in one sentence, one or more precise changes ' +
      '(each with the exact filePath, startLine/endLine as shown in the numbered source, the verbatim ' +
      'original code at that range, and the replacement code), a unified-diff-style patch string for ' +
      'reference, the list of tests you expect to pass after this change, and any risks.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
