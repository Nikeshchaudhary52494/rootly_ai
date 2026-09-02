import type { InvestigationInput, InvestigationStateUpdate } from '../investigation.state';

const MAX_FILES = 10;
const MAX_LINES_PER_FILE = 150;
const MAX_COMMITS = 10;

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return [...lines.slice(0, maxLines), `... (truncated — ${lines.length - maxLines} more lines omitted)`].join('\n');
}

/** Caps files/lines/commits sent to the LLM. Phase 4 already collects a tight
 * context, but this is the backstop if that ever grows. */
function applyContextBudget(codeContext: NonNullable<InvestigationInput['codeContext']>) {
  return {
    ...codeContext,
    files: codeContext.files
      .slice(0, MAX_FILES)
      .map((f) => ({ ...f, content: truncateContent(f.content, MAX_LINES_PER_FILE) })),
    relatedTests: codeContext.relatedTests
      .slice(0, MAX_FILES)
      .map((f) => ({ ...f, content: truncateContent(f.content, MAX_LINES_PER_FILE) })),
    recentCommits: codeContext.recentCommits.slice(0, MAX_COMMITS),
  };
}

/** Validates that enough context exists to investigate, and budgets what's supplied. Calls no LLM. */
export function loadContextNode(state: { input: InvestigationInput | null }): InvestigationStateUpdate {
  const { input } = state;

  if (!input) {
    return { status: 'FAILED', errors: ['No investigation input was supplied.'] };
  }

  if (!input.codeContext || input.codeContext.status !== 'READY') {
    return {
      status: 'FAILED',
      errors: ['Code context has not been collected for this incident.'],
    };
  }

  const primaryFile = input.codeContext.files.find((f) => f.isPrimary);
  if (!primaryFile) {
    return {
      status: 'FAILED',
      errors: ['Code context has no primary source file to investigate.'],
    };
  }

  return {
    status: 'ANALYZING_ERROR',
    input: { ...input, codeContext: applyContextBudget(input.codeContext) },
  };
}
