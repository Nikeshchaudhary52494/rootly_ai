import type { InvestigationCodeContext, InvestigationInput } from '../graph/investigation.state';

/** Read-only: the code context already collected for this incident (Phase 4's output). No network calls. */
export function getIncidentContext(input: InvestigationInput): InvestigationCodeContext | null {
  return input.codeContext;
}
