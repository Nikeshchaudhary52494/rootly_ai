import type { InvestigationCodeContext } from '../graph/investigation.state';

export interface RepositorySearchMatch {
  filePath: string;
  lineNumber: number;
  line: string;
}

/**
 * Read-only substring search across the files already collected for this
 * incident (never fetches anything new from GitHub — search is bounded to
 * what Phase 4 already pulled in).
 */
export function searchRepository(codeContext: InvestigationCodeContext, query: string): RepositorySearchMatch[] {
  const needle = query.toLowerCase();
  const matches: RepositorySearchMatch[] = [];

  const files = [
    ...codeContext.files.map((f) => ({ filePath: f.filePath, content: f.content, startLine: f.contentStartLine })),
    ...codeContext.relatedTests.map((f) => ({ filePath: f.filePath, content: f.content, startLine: 1 })),
  ];

  for (const file of files) {
    file.content.split('\n').forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) {
        matches.push({ filePath: file.filePath, lineNumber: file.startLine + i, line: line.trim() });
      }
    });
  }

  return matches;
}
