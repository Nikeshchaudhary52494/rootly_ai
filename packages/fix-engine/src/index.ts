export { validatePatchSafety, verifyOriginalContent, DEFAULT_PATCH_SAFETY_LIMITS } from './patch/patch-validator';
export type { PatchSafetyLimits, PatchValidationResult } from './patch/patch-validator';
export { applyChangesToFile, renderUnifiedDiff } from './patch/patch-parser';
export { generateFixProposal } from './patch/patch-generator';
export type { PatchGenerationResult } from './patch/patch-generator';
export { generatePostFixValidationTest } from './patch/post-fix-test-generator';
export type { PostFixTestGenerationResult } from './patch/post-fix-test-generator';

export { createFixSandbox, loadFixSandboxConfig } from './sandbox/fix-sandbox';
export { buildReproductionCheckCommand, buildPostFixValidationCommand, buildRegressionCommand } from './sandbox/sandbox-runner';

export { evaluateBeforeFixReproduction, evaluatePostFixValidation } from './validation/reproduction-validator';
export type { PostFixOutcome, PostFixValidationOutcome } from './validation/reproduction-validator';
export { parseJestSummary, evaluateRegressionResult, skippedRegressionResult } from './validation/regression-validator';
export type { JestSummary, RegressionOutcome, RegressionResult } from './validation/regression-validator';
export { classifyFix } from './validation/fix-classifier';
export type { FixClassification, FixClassificationInput, FixClassificationOutput } from './validation/fix-classifier';

export { runFixAttempt } from './fix/fix-engine';
export type { FixEngineInput, FixEngineOptions, FixEngineResult, FixEngineStage, FixPatchRecord, ValidationSummary } from './fix/fix-engine';

export { FixProposalSchema } from './schemas/fix-proposal.schema';
export type { FixProposal, FileChange } from './schemas/fix-proposal.schema';
export { FixAnalysisSchema } from './schemas/fix-analysis.schema';
export type { FixAnalysis } from './schemas/fix-analysis.schema';
export { PostFixValidationSchema } from './schemas/post-fix-validation.schema';
export type { PostFixValidation } from './schemas/post-fix-validation.schema';

export type {
  FixGenerationInput,
  FixGenerationIncident,
  FixGenerationInvestigation,
  FixGenerationReproduction,
  FixGenerationCodeContext,
  FixGenerationCodeFile,
  FixGenerationTestFile,
} from './graph/fix-generation.state';
