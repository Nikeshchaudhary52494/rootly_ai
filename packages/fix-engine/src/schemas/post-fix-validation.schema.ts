import { z } from 'zod';

export const PostFixValidationSchema = z.object({
  filePath: z.string().min(1),
  content: z.string().min(1),
  testName: z.string().min(1),
  expectedBehavior: z.string().min(1),
});
export type PostFixValidation = z.infer<typeof PostFixValidationSchema>;
