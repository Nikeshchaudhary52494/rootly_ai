import { posix } from 'node:path';

export const REPRODUCTION_TEST_DIR = 'reproduction-tests/';
const ALLOWED_EXTENSIONS = ['.test.js', '.test.ts', '.spec.js', '.spec.ts'];

interface ForbiddenPattern {
  pattern: RegExp;
  reason: string;
}

// Anti-tamper / anti-escape gate for AI-generated content. Never trust arbitrary
// model output enough to execute it — every one of these would let a generated
// "test" step outside being a passive assertion over repository code.
const FORBIDDEN_PATTERNS: ForbiddenPattern[] = [
  { pattern: /require\(\s*['"]child_process['"]\s*\)/, reason: 'imports child_process' },
  { pattern: /from\s+['"]child_process['"]/, reason: 'imports child_process' },
  { pattern: /\bexecSync\s*\(/, reason: 'calls execSync(...)' },
  { pattern: /\bexec\s*\(/, reason: 'calls exec(...)' },
  { pattern: /\bspawnSync\s*\(/, reason: 'calls spawnSync(...)' },
  { pattern: /\bspawn\s*\(/, reason: 'calls spawn(...)' },
  { pattern: /\beval\s*\(/, reason: 'calls eval(...)' },
  { pattern: /new\s+Function\s*\(/, reason: 'constructs a Function from a string' },
  { pattern: /require\(\s*['"](https?|net|dgram|dns|tls)['"]\s*\)/, reason: 'imports a raw network module' },
  { pattern: /from\s+['"](https?|net|dgram|dns|tls)['"]/, reason: 'imports a raw network module' },
  { pattern: /\bfetch\s*\(/, reason: 'calls fetch(...)' },
  { pattern: /require\(\s*['"](axios|node-fetch|got|undici)['"]\s*\)/, reason: 'imports a network client library' },
  { pattern: /from\s+['"](axios|node-fetch|got|undici)['"]/, reason: 'imports a network client library' },
  { pattern: /process\.env/, reason: 'accesses process.env' },
  { pattern: /require\(\s*['"]fs(\/promises)?['"]\s*\)/, reason: 'imports the fs module' },
  { pattern: /from\s+['"]fs(\/promises)?['"]/, reason: 'imports the fs module' },
  { pattern: /\bsh\s+-c\b|\bbash\s+-c\b/, reason: 'invokes a shell' },
  { pattern: /process\.exit\s*\(/, reason: 'calls process.exit(...)' },
];

export interface TestValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface ValidatableTest {
  filePath: string;
  content: string;
}

/**
 * Static validation gate a generated test must pass before it's ever written
 * to disk or executed. Purely syntactic/pattern-based — this is not a
 * sandboxing mechanism by itself, it's the first of several layers (see
 * docker-sandbox.ts for the runtime isolation).
 */
export function validateGeneratedTest(test: ValidatableTest): TestValidationResult {
  const reasons: string[] = [];

  if (posix.isAbsolute(test.filePath)) {
    reasons.push('filePath must be relative, not absolute');
  }
  if (test.filePath.includes('..')) {
    reasons.push('filePath must not contain path traversal ("..")');
  }
  if (!test.filePath.startsWith(REPRODUCTION_TEST_DIR)) {
    reasons.push(`filePath must be inside ${REPRODUCTION_TEST_DIR}`);
  }
  if (!ALLOWED_EXTENSIONS.some((ext) => test.filePath.endsWith(ext))) {
    reasons.push(`filePath must end with one of: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  const looksLikeJestTest = /\b(describe|test|it)\s*\(/.test(test.content) && /\bexpect\s*\(/.test(test.content);
  if (!looksLikeJestTest) {
    reasons.push('content does not look like a Jest test (expected describe/it/test with an expect(...) assertion)');
  }

  for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
    if (pattern.test(test.content)) {
      reasons.push(`content is not allowed: ${reason}`);
    }
  }

  return { valid: reasons.length === 0, reasons };
}

/** True if the test only references relative modules (plus Node/Jest builtins) — used to skip a needless install step. */
export function requiresDependencyInstall(content: string): boolean {
  const importPattern = /(?:require\(\s*['"]([^'"]+)['"]\s*\)|from\s+['"]([^'"]+)['"])/g;
  const builtins = new Set(['node:test', 'node:assert', 'assert', '@jest/globals']);

  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(content))) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    if (specifier.startsWith('.')) continue; // relative — part of the checked-out repo itself
    if (builtins.has(specifier)) continue;
    return true; // a bare package specifier that isn't a known builtin
  }
  return false;
}
