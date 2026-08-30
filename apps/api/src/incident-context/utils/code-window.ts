export interface CodeWindow {
  content: string;
  contentStartLine: number;
  contentEndLine: number;
}

const CONTEXT_LINES = 20;

/** Extracts up to 20 lines before/after the target line, clamped to file bounds. 1-indexed. */
export function extractCodeWindow(fileContent: string, targetLine: number, contextLines = CONTEXT_LINES): CodeWindow {
  const lines = fileContent.split('\n');
  const clampedTarget = Math.min(Math.max(1, targetLine), lines.length);

  const contentStartLine = Math.max(1, clampedTarget - contextLines);
  const contentEndLine = Math.min(lines.length, clampedTarget + contextLines);

  return {
    content: lines.slice(contentStartLine - 1, contentEndLine).join('\n'),
    contentStartLine,
    contentEndLine,
  };
}
