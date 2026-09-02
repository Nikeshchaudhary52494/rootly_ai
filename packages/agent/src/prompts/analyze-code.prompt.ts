import { systemPrompt } from './shared';
import type { ErrorAnalysis } from '../schemas/investigation.schema';
import type { InvestigationCodeFile, InvestigationTestFile } from '../graph/investigation.state';

function renderFile(file: InvestigationCodeFile): string {
  const numbered = file.content
    .split('\n')
    .map((line, i) => `${file.contentStartLine + i}: ${line}`)
    .join('\n');
  return [
    `File: ${file.filePath}${file.isPrimary ? ' (primary — where the stack trace points)' : ''}`,
    file.functionName ? `Function: ${file.functionName}` : null,
    '```',
    numbered,
    '```',
  ]
    .filter(Boolean)
    .join('\n');
}

function renderTest(file: InvestigationTestFile): string {
  return [`Test file: ${file.filePath}`, '```', file.content, '```'].join('\n');
}

export function analyzeCodePrompt(
  errorAnalysis: ErrorAnalysis,
  files: InvestigationCodeFile[],
  tests: InvestigationTestFile[],
) {
  const system = systemPrompt(
    'You are a senior software engineer reviewing source code for a production incident. Point out only ' +
      'what the code actually shows — every observation must cite a file and line range that appears verbatim ' +
      'below.',
  );

  const user = [
    'Error analysis so far:',
    JSON.stringify(errorAnalysis, null, 2),
    '',
    'Source files (line numbers shown are real line numbers in the repository):',
    files.map(renderFile).join('\n\n') || '(no source files were resolved)',
    '',
    'Related tests:',
    tests.map(renderTest).join('\n\n') || '(no related tests were found)',
    '',
    'List concrete observations about the code that relate to this error. Each observation must reference an ' +
      'exact file path and line range copied from the file listing above.',
  ].join('\n');

  return { system, user };
}
