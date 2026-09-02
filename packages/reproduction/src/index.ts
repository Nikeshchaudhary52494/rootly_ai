export { DockerSandbox } from './sandbox/docker-sandbox';
export { loadSandboxConfig, DEFAULT_SANDBOX_CONFIG } from './sandbox/sandbox-config';
export type { SandboxConfig } from './sandbox/sandbox-config';
export type { SandboxExecutionResult } from './sandbox/sandbox-result';

export { checkoutRepository, RepositoryCheckoutError } from './repository/repository-checkout';
export type { CheckoutOptions, CheckoutResult } from './repository/repository-checkout';
export { runGit } from './repository/git-utils';

export { validateGeneratedTest, requiresDependencyInstall, REPRODUCTION_TEST_DIR } from './test/test-validator';
export type { TestValidationResult, ValidatableTest } from './test/test-validator';
export { buildJestCommand, buildInstallCommand } from './test/test-runner';
export { generateReproductionTest } from './test/test-generator';
export type { TestGenerationResult } from './test/test-generator';

export { classifyReproduction } from './reproduction/reproduction-classifier';
export type {
  ReproductionClassification,
  ClassificationInput,
  ClassificationOutput,
} from './reproduction/reproduction-classifier';
export { determineTargetCommit } from './reproduction/target-commit';
export type { TargetCommitInput } from './reproduction/target-commit';
export { runReproduction } from './reproduction/reproduction-engine';
export type {
  ReproductionEngineInput,
  ReproductionEngineOptions,
  ReproductionEngineResult,
  ReproductionEngineStage,
} from './reproduction/reproduction-engine';

export { ReproductionTestSchema } from './schemas/reproduction.schema';
export type { ReproductionTest, ReproductionLanguage } from './schemas/reproduction.schema';
export { FailureUnderstandingSchema } from './schemas/failure-understanding.schema';
export type { FailureUnderstanding } from './schemas/failure-understanding.schema';

export type {
  TestGenerationInput,
  GenerationIncident,
  GenerationEvent,
  GenerationInvestigation,
  GenerationHypothesis,
  GenerationCodeContext,
  GenerationCodeFile,
  GenerationTestFile,
} from './graph/generation.state';
