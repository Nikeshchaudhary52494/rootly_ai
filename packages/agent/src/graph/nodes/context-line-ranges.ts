import type { InvestigationCodeContext } from '../investigation.state';

export interface KnownFileRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

/** Every file path + valid line range the model was actually shown, for grounding checks. */
export function buildKnownFileRanges(codeContext: InvestigationCodeContext): KnownFileRange[] {
  const fromFiles = codeContext.files.map((f) => ({
    filePath: f.filePath,
    startLine: f.contentStartLine,
    endLine: f.contentEndLine,
  }));
  const fromTests = codeContext.relatedTests.map((t) => ({
    filePath: t.filePath,
    startLine: 1,
    endLine: Math.max(1, t.content.split('\n').length),
  }));
  return [...fromFiles, ...fromTests];
}

export function isLineWithinKnownFile(ranges: KnownFileRange[], filePath: string, line: number): boolean {
  return ranges.some((r) => r.filePath === filePath && line >= r.startLine && line <= r.endLine);
}

export function isKnownFile(ranges: KnownFileRange[], filePath: string): boolean {
  return ranges.some((r) => r.filePath === filePath);
}
