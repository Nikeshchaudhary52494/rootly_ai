import { systemPrompt } from './shared';
import type { FixGenerationInput } from '../graph/fix-generation.state';

function renderFile(file: FixGenerationInput['codeContext']['files'][number]): string {
  const numbered = file.content
    .split('\n')
    .map((line, i) => `${file.contentStartLine + i}: ${line}`)
    .join('\n');
  return [`File: ${file.filePath}`, file.functionName ? `Function: ${file.functionName}` : null, '```', numbered, '```']
    .filter(Boolean)
    .join('\n');
}

export function analyzeFixPrompt(input: FixGenerationInput) {
  const system = systemPrompt(
    'You are a senior software engineer preparing to fix a confirmed, reproduced production bug. Before ' +
      'writing any code, precisely identify the single root cause and the smallest change that would fix it.',
  );

  const user = [
    'Incident:',
    `- ${input.incident.errorName}: ${input.incident.errorMessage}`,
    input.incident.stackTrace ? `- Stack trace:\n${input.incident.stackTrace}` : null,
    '',
    'AI investigation:',
    `- Root cause: ${input.investigation.rootCause}`,
    input.investigation.recommendation ? `- Recommendation: ${input.investigation.recommendation}` : null,
    '',
    'This bug has already been reproduced by a real, executed test:',
    `File: ${input.reproduction.testFilePath}`,
    '```',
    input.reproduction.generatedTest,
    '```',
    'Its execution output:',
    input.reproduction.stdout || input.reproduction.stderr || '(no output captured)',
    '',
    'Source files:',
    input.codeContext.files.map(renderFile).join('\n\n'),
    '',
    'Identify: the exact file and function/export that must change, a one-paragraph summary of the actual ' +
      'root cause, and the smallest change that would fix it (described in prose — you will write the real ' +
      'code in the next step).',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
