import { z } from 'zod';

export const FailureUnderstandingSchema = z.object({
  targetFile: z.string().min(1),
  targetFunctionOrExport: z.string().min(1),
  failureCondition: z.string().min(1),
  expectedFailureType: z.string().min(1),
  reproductionApproach: z.string().min(1),
});
export type FailureUnderstanding = z.infer<typeof FailureUnderstandingSchema>;
