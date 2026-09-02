import { posix } from 'node:path';
import type { FileChange } from '../schemas/fix-proposal.schema';

export interface PatchSafetyLimits {
  maxFiles: number;
  maxChangedLines: number;
  maxPatchBytes: number;
}

export const DEFAULT_PATCH_SAFETY_LIMITS: PatchSafetyLimits = {
  maxFiles: 5,
  maxChangedLines: 100,
  maxPatchBytes: 50000,
};

export interface PatchValidationResult {
  valid: boolean;
  reasons: string[];
}

// Never editable by an AI-proposed patch, regardless of what the investigation says.
// Exported so downstream packages (e.g. @rootly.ai/github's promotion validator)
// can re-check the same list rather than maintaining a second copy.
export const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.env[^/]*$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)Dockerfile[^/]*$/i,
  /(^|\/)\.github\//,
];

/**
 * Path + forbidden-file + size-limit checks — the same kind of static gate as
 * Phase 6's test-validator, applied to a proposed code change instead of a
 * generated test. Does not touch the filesystem; see verifyOriginalContent
 * for the (separate, per-file) check that the AI's claimed original content
 * actually matches the repository.
 */
export function validatePatchSafety(
  changes: FileChange[],
  limits: PatchSafetyLimits = DEFAULT_PATCH_SAFETY_LIMITS,
): PatchValidationResult {
  const reasons: string[] = [];

  if (changes.length === 0) {
    return { valid: false, reasons: ['the patch must change at least one file'] };
  }

  const uniqueFiles = new Set(changes.map((c) => c.filePath));
  if (uniqueFiles.size > limits.maxFiles) {
    reasons.push(`the patch touches ${uniqueFiles.size} files, exceeding the limit of ${limits.maxFiles}`);
  }

  let totalChangedLines = 0;
  let totalBytes = 0;

  for (const change of changes) {
    if (posix.isAbsolute(change.filePath)) {
      reasons.push(`${change.filePath}: absolute paths are not allowed`);
    }
    if (change.filePath.includes('..')) {
      reasons.push(`${change.filePath}: path traversal ("..") is not allowed`);
    }
    if (FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(change.filePath))) {
      reasons.push(`${change.filePath}: this file may not be modified by an automated fix`);
    }
    if (change.endLine < change.startLine) {
      reasons.push(`${change.filePath}: endLine (${change.endLine}) must be >= startLine (${change.startLine})`);
    }

    const originalLineCount = change.originalCode.split('\n').length;
    const replacementLineCount = change.replacementCode.split('\n').length;
    totalChangedLines += Math.max(originalLineCount, replacementLineCount);
    totalBytes += Buffer.byteLength(change.originalCode, 'utf8') + Buffer.byteLength(change.replacementCode, 'utf8');
  }

  if (totalChangedLines > limits.maxChangedLines) {
    reasons.push(`the patch changes approximately ${totalChangedLines} lines, exceeding the limit of ${limits.maxChangedLines}`);
  }
  if (totalBytes > limits.maxPatchBytes) {
    reasons.push(`the patch size (${totalBytes} bytes) exceeds the limit of ${limits.maxPatchBytes} bytes`);
  }

  return { valid: reasons.length === 0, reasons };
}

/**
 * The single most important trust boundary in the fix engine: an AI claim
 * about what the code currently looks like is worthless until checked
 * against the actual, real file content at the exact line range it named.
 * Never apply a change on the strength of line numbers alone.
 */
export function verifyOriginalContent(fileContent: string, change: FileChange): boolean {
  const lines = fileContent.split('\n');
  if (change.startLine < 1 || change.endLine > lines.length) return false;
  const actual = lines.slice(change.startLine - 1, change.endLine).join('\n');
  return actual === change.originalCode;
}
