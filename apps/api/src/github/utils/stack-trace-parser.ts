export interface StackFrame {
  functionName: string | null;
  filePath: string;
  line: number | null;
  column: number | null;
}

export interface ParsedStackTrace {
  frames: StackFrame[];
}

// Common container/runtime roots that wrap an app checkout — stripped so the
// remaining path has a shot at matching a path inside the GitHub repository.
const KNOWN_ROOT_PREFIXES = ['/app/', '/usr/src/app/', '/home/node/app/'];

function normalizePath(rawPath: string): string {
  for (const prefix of KNOWN_ROOT_PREFIXES) {
    if (rawPath.startsWith(prefix)) return rawPath.slice(prefix.length);
  }
  return rawPath.replace(/^\/+/, '');
}

function splitLocation(raw: string): { filePath: string; line: number | null; column: number | null } {
  const withLineAndColumn = raw.match(/^(.*):(\d+):(\d+)$/);
  if (withLineAndColumn) {
    return { filePath: withLineAndColumn[1], line: Number(withLineAndColumn[2]), column: Number(withLineAndColumn[3]) };
  }

  const withLineOnly = raw.match(/^(.*):(\d+)$/);
  if (withLineOnly) {
    return { filePath: withLineOnly[1], line: Number(withLineOnly[2]), column: null };
  }

  return { filePath: raw, line: null, column: null };
}

function parseFrameLine(line: string): StackFrame | null {
  const withFunctionName = line.match(/^at\s+(.+?)\s+\((.+)\)$/);
  const raw = withFunctionName ? withFunctionName[2] : line.replace(/^at\s+/, '');
  if (!raw) return null;

  const functionName = withFunctionName ? withFunctionName[1] : null;
  const { filePath, line: lineNumber, column } = splitLocation(raw);

  return { functionName, filePath: normalizePath(filePath), line: lineNumber, column };
}

/** Parses a Node.js stack trace into structured frames with normalized file paths. */
export function parseStackTrace(stack?: string): ParsedStackTrace {
  if (!stack) return { frames: [] };

  const frames: StackFrame[] = [];
  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) continue;

    const frame = parseFrameLine(line);
    if (frame) frames.push(frame);
  }

  return { frames };
}
