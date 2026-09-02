import { z } from 'zod';

export const FixAnalysisSchema = z.object({
  targetFile: z.string().min(1),
  targetFunctionOrExport: z.string().min(1),
  rootCauseSummary: z.string().min(1),
  proposedApproach: z.string().min(1),
});
export type FixAnalysis = z.infer<typeof FixAnalysisSchema>;
