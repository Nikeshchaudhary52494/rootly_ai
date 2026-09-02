import { FORBIDDEN_PATH_PATTERNS, DEFAULT_PATCH_SAFETY_LIMITS, type PatchSafetyLimits } from '@rootly.ai/fix-engine';

export interface PromotionPatchFile {
  filePath: string;
  /** The unified diff already computed and stored on FixPatch in Phase 7 — never recomputed here. */
  diff: string;
}

export interface PromotionValidationResult {
  valid: boolean;
  reasons: string[];
}

/**
 * Re-applies the same forbidden-path and size limits Phase 7 already
 * enforced, this time against the FixPatch rows being promoted — a second,
 * independent gate before anything is pushed to a real GitHub branch. Uses
 * the same FORBIDDEN_PATH_PATTERNS / PatchSafetyLimits as @rootly.ai/fix-engine
 * rather than a second copy of the rules.
 */
export function validatePromotionPatchSet(
  files: PromotionPatchFile[],
  limits: PatchSafetyLimits = DEFAULT_PATCH_SAFETY_LIMITS,
): PromotionValidationResult {
  const reasons: string[] = [];

  if (files.length === 0) {
    return { valid: false, reasons: ['the patch must change at least one file'] };
  }

  if (files.length > limits.maxFiles) {
    reasons.push(`the patch touches ${files.length} files, exceeding the limit of ${limits.maxFiles}`);
  }

  let totalChangedLines = 0;
  for (const file of files) {
    if (file.filePath.includes('..')) {
      reasons.push(`${file.filePath}: path traversal ("..") is not allowed`);
    }
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(file.filePath))) {
      reasons.push(`${file.filePath}: this file may not be modified by an automated fix`);
    }
    totalChangedLines += countChangedLines(file.diff);
  }

  if (totalChangedLines > limits.maxChangedLines) {
    reasons.push(`the patch changes approximately ${totalChangedLines} lines, exceeding the limit of ${limits.maxChangedLines}`);
  }

  return { valid: reasons.length === 0, reasons };
}

function countChangedLines(diff: string): number {
  return diff
    .split('\n')
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))).length;
}

/**
 * After patches are written to a real checkout, `git diff --name-only`
 * tells us what actually changed on disk. This must be exactly the set of
 * files FixPatch recorded — not a superset (something else got touched) and
 * not a subset (a write silently failed).
 */
export function validateChangedFileSet(expectedFiles: string[], actualChangedFiles: string[]): PromotionValidationResult {
  const expected = new Set(expectedFiles);
  const actual = new Set(actualChangedFiles);
  const reasons: string[] = [];

  for (const file of actual) {
    if (!expected.has(file)) reasons.push(`unexpected file changed: ${file}`);
  }
  for (const file of expected) {
    if (!actual.has(file)) reasons.push(`expected file was not changed: ${file}`);
  }

  return { valid: reasons.length === 0, reasons };
}
