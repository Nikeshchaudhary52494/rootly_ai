import { z } from 'zod';

export const FileChangeSchema = z.object({
  filePath: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  originalCode: z.string().min(1),
  replacementCode: z.string(),
  explanation: z.string().min(1),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

/**
 * `patch` is kept for transparency (what the model believes it changed) but
 * is never used to apply anything — the backend regenerates the canonical
 * diff itself from `changes` once each one is verified against the real
 * file content. See patch/patch-parser.ts.
 */
export const FixProposalSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().min(1),
  changes: z.array(FileChangeSchema).min(1).max(10),
  patch: z.string(),
  testsExpectedToPass: z.array(z.string()).max(20),
  risks: z.array(z.string()).max(10),
});
export type FixProposal = z.infer<typeof FixProposalSchema>;
