import { systemPrompt } from './shared';
import type { TestGenerationInput } from '../graph/generation.state';

function renderFile(file: TestGenerationInput['codeContext']['files'][number]): string {
  const numbered = file.content
    .split('\n')
    .map((line, i) => `${file.contentStartLine + i}: ${line}`)
    .join('\n');
  return [`File: ${file.filePath}`, file.functionName ? `Function: ${file.functionName}` : null, '```', numbered, '```']
    .filter(Boolean)
    .join('\n');
}

export function understandFailurePrompt(input: TestGenerationInput) {
  const system = systemPrompt(
    'You are a senior software engineer preparing to write a regression test that reproduces a specific ' +
      'production failure. Before writing any code, precisely identify what must be reproduced.',
  );

  const user = [
    'Incident:',
    `- Error: ${input.incident.errorName}: ${input.incident.errorMessage}`,
    `- Occurrences: ${input.incident.occurrenceCount}`,
    input.latestEvent?.stackTrace ? `- Stack trace:\n${input.latestEvent.stackTrace}` : null,
    '',
    'AI investigation root cause:',
    input.investigation.rootCause,
    input.investigation.summary ? `Summary: ${input.investigation.summary}` : null,
    '',
    'Source files:',
    input.codeContext.files.map(renderFile).join('\n\n'),
    '',
    'Identify: the exact file and function/export responsible, the precise condition that triggers the ' +
      'failure, the expected error type (or other observable failure), and a short plan for how a test ' +
      'could construct that condition using only the code shown above.',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}
