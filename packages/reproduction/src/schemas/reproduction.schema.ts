import { z } from 'zod';

export const ReproductionLanguageSchema = z.enum(['typescript', 'javascript']);
export type ReproductionLanguage = z.infer<typeof ReproductionLanguageSchema>;

/** MVP supports exactly one language/framework combo — see packages/reproduction README. */
export const ReproductionTestSchema = z.object({
  filePath: z.string().min(1),
  testName: z.string().min(1),
  language: ReproductionLanguageSchema,
  framework: z.literal('jest'),
  content: z.string().min(1),
  explanation: z.string().min(1),
});
export type ReproductionTest = z.infer<typeof ReproductionTestSchema>;
