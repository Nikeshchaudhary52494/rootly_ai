import type { InvestigationCodeContext } from '../graph/investigation.state';

export interface FileContext {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
}

/** Read-only: looks up one already-fetched file (primary source or related test) by path. */
export function getFileContext(codeContext: InvestigationCodeContext, filePath: string): FileContext | null {
  const sourceFile = codeContext.files.find((f) => f.filePath === filePath);
  if (sourceFile) {
    return {
      filePath,
      content: sourceFile.content,
      startLine: sourceFile.contentStartLine,
      endLine: sourceFile.contentEndLine,
    };
  }

  const testFile = codeContext.relatedTests.find((f) => f.filePath === filePath);
  if (testFile) {
    return { filePath, content: testFile.content, startLine: 1, endLine: testFile.content.split('\n').length };
  }

  return null;
}
