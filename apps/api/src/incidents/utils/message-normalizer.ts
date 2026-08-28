const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_HEX_ID_PATTERN = /\b[0-9a-f]{8,}\b/gi;
const NUMBER_PATTERN = /\d+/g;

/**
 * Collapses dynamic values (ids, emails, numbers) in an error message so that
 * e.g. "User 123 not found" and "User 456 not found" fingerprint the same.
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(UUID_PATTERN, '<uuid>')
    .replace(EMAIL_PATTERN, '<email>')
    .replace(LONG_HEX_ID_PATTERN, (match) => (/[a-f]/i.test(match) ? '<id>' : match))
    .replace(NUMBER_PATTERN, '<number>');
}
