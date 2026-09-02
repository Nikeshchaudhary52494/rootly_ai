export { GitHubClient, GitHubClientError } from './client/github-client';
export type { GitHubRef, GitHubPullRequestInfo, GitHubClientErrorCode } from './client/github-client';

export { slugify, generateBranchName, resolveUniqueBranchName } from './branch/branch-manager';

export { generateCommitMessage } from './commit/commit-manager';
export type { CommitMessageInput, CommitMessage } from './commit/commit-manager';

export { generatePullRequestContent } from './pull-request/pull-request-manager';
export type { PullRequestContentInput, PullRequestContent } from './pull-request/pull-request-manager';

export { computePatchHash, verifyPatchIntegrity } from './patch/patch-integrity';

export { validatePromotionPatchSet, validateChangedFileSet } from './promotion/promotion-validator';
export type { PromotionPatchFile, PromotionValidationResult } from './promotion/promotion-validator';

export { checkoutForPromotion, PromotionCheckoutError } from './promotion/promotion-checkout';
export type { PromotionCheckoutOptions, PromotionCheckoutResult } from './promotion/promotion-checkout';

export { runPrPromotion } from './promotion/pr-promotion';
export type {
  PrPromotionInput,
  PrPromotionOptions,
  PrPromotionResult,
  PrPromotionStage,
  PrPromotionErrorCode,
  PrPromotionPatch,
} from './promotion/pr-promotion';
