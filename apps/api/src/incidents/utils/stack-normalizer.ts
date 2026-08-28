const NOISE_PATTERNS = [/node_modules/, /^node:/, /^internal\//, /\(native\)/];

const DEFAULT_FRAME_LIMIT = 3;

/**
 * Pulls the top application source frames out of a Node.js stack trace,
 * stripped of line/column numbers so unrelated line shifts don't fork the fingerprint.
 * Skips node_modules/runtime-internal frames. Falls back to [] when there's no stack.
 */
export function extractRelevantStackFrames(stack?: string, limit = DEFAULT_FRAME_LIMIT): string[] {
  if (!stack) return [];

  const frames: string[] = [];

  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) continue;

    const path = extractFramePath(line);
    if (!path || NOISE_PATTERNS.some((pattern) => pattern.test(path))) continue;

    frames.push(path);
    if (frames.length >= limit) break;
  }

  return frames;
}

function extractFramePath(line: string): string | null {
  const parenMatch = line.match(/\(([^)]+)\)\s*$/);
  const raw = parenMatch ? parenMatch[1] : line.replace(/^at\s+/, '');
  const withoutLocation = raw.replace(/:\d+:\d+$/, '').trim();
  return withoutLocation || null;
}
