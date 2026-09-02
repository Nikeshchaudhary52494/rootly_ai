import { systemPrompt } from './shared';
import type { InvestigationEvent, InvestigationIncident } from '../graph/investigation.state';

export function analyzeErrorPrompt(incident: InvestigationIncident, event: InvestigationEvent) {
  const system = systemPrompt(
    'You are a senior software engineer triaging a production incident. Extract the observable facts about ' +
      'this error only — do not propose a root cause yet, that happens in a later step.',
  );

  const user = [
    'Incident:',
    `- Title: ${incident.title}`,
    `- Status: ${incident.status}`,
    `- Occurrences: ${incident.occurrenceCount}`,
    '',
    'Latest error event:',
    `- Error name: ${event.errorName}`,
    `- Error message: ${event.errorMessage}`,
    `- Service: ${event.serviceName}`,
    `- Environment: ${event.environmentName}`,
    `- Release: ${event.release ?? 'unknown'}`,
    `- Timestamp: ${event.timestamp}`,
    '',
    'Stack trace:',
    event.stackTrace ?? '(no stack trace was captured)',
    '',
    'Identify: the error type, a normalized (dynamic-value-free) version of the message, the primary source ' +
      'location the stack trace points to if any (a file path and line number literally present in the stack ' +
      'trace above), and a short list of factual observations about the error itself.',
  ].join('\n');

  return { system, user };
}
