export type EnvironmentType = 'DEVELOPMENT' | 'STAGING' | 'PRODUCTION';

export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: EnvironmentType;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyMetadata {
  id: string;
  name: string;
  keyPrefix: string;
  projectId: string;
  environmentId: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreated extends ApiKeyMetadata {
  apiKey: string;
  message: string;
}

export type IncidentStatus = 'OPEN' | 'RESOLVED' | 'IGNORED';

export interface IncidentRef {
  id: string;
  sequenceNumber: number;
  status: IncidentStatus;
}

export interface ErrorEventSummary {
  id: string;
  eventId: string;
  projectId: string;
  environmentId: string;
  serviceName: string;
  environmentName: string;
  release: string | null;
  errorName: string;
  errorMessage: string;
  timestamp: string;
  receivedAt: string;
  incident: IncidentRef | null;
}

export interface ErrorEventDetail extends ErrorEventSummary {
  apiKeyId: string;
  stackTrace: string | null;
  fingerprint: string;
  metadata: unknown;
  createdAt: string;
}

export interface IncidentSummary {
  id: string;
  sequenceNumber: number;
  title: string;
  errorName: string;
  errorMessage: string;
  status: IncidentStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  environment: { id: string; name: string };
}

export interface IncidentDetail {
  id: string;
  projectId: string;
  environmentId: string;
  sequenceNumber: number;
  fingerprint: string;
  title: string;
  errorName: string;
  errorMessage: string;
  status: IncidentStatus;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  latestEventId: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  environment: { id: string; name: string };
  latestEvent: ErrorEventDetail | null;
  recentEvents: ErrorEventDetail[];
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

export type InvestigationStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'LOADING_CONTEXT'
  | 'ANALYZING_ERROR'
  | 'ANALYZING_CODE'
  | 'ANALYZING_HISTORY'
  | 'GENERATING_HYPOTHESES'
  | 'EVALUATING_EVIDENCE'
  | 'GENERATING_REPORT'
  | 'COMPLETED'
  | 'FAILED';

export type HypothesisStatus = 'LIKELY' | 'POSSIBLE' | 'REJECTED';
export type EvidenceType = 'SUPPORTING' | 'CONTRADICTING';
export type EvidenceSourceType = 'ERROR' | 'SOURCE_CODE' | 'STACK_TRACE' | 'TEST' | 'GIT_COMMIT' | 'CONFIGURATION';

export interface InvestigationHypothesis {
  id: string;
  title: string;
  description: string;
  confidence: number;
  rank: number;
  status: HypothesisStatus;
}

export interface InvestigationEvidenceItem {
  id: string;
  hypothesisId: string;
  type: EvidenceType;
  description: string;
  sourceType: EvidenceSourceType;
  sourceReference: string;
  lineStart: number | null;
  lineEnd: number | null;
  confidence: number;
}

export interface InvestigationDetail {
  id: string;
  incidentId: string;
  status: InvestigationStatus;
  model: string;
  summary: string | null;
  recommendation: string | null;
  finalConfidence: number | null;
  errorMessage: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  hypotheses: InvestigationHypothesis[];
  evidence: InvestigationEvidenceItem[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface InvestigationSummary {
  id: string;
  status: InvestigationStatus;
  model: string;
  finalConfidence: number | null;
  summary: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type RepositoryProvider = 'GITHUB';

export interface Repository {
  id: string;
  projectId: string;
  provider: RepositoryProvider;
  owner: string;
  name: string;
  repositoryUrl: string;
  defaultBranch: string;
  connectedAt: string;
  lastValidatedAt: string | null;
  lastSyncedAt: string | null;
}

export type IncidentCodeContextStatus = 'PENDING' | 'COLLECTING' | 'READY' | 'FAILED';

export interface IncidentCodeFile {
  filePath: string;
  functionName: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  contentStartLine: number;
  contentEndLine: number;
  content: string;
  isPrimary: boolean;
}

export interface IncidentRelatedTest {
  filePath: string;
  content: string;
}

export interface IncidentCodeCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
}

export interface IncidentCodeContext {
  id: string;
  status: IncidentCodeContextStatus;
  summary: string | null;
  primaryLocation: { filePath: string; lineNumber: number | null } | null;
  files: IncidentCodeFile[];
  relatedTests: IncidentRelatedTest[];
  recentCommits: IncidentCodeCommit[];
}

export type ReproductionStatus =
  | 'PENDING'
  | 'GENERATING_TEST'
  | 'CREATING_SANDBOX'
  | 'CHECKING_OUT'
  | 'INSTALLING'
  | 'RUNNING'
  | 'CLASSIFYING'
  | 'COMPLETED'
  | 'FAILED';

export type ReproductionResult = 'REPRODUCED' | 'NOT_REPRODUCED' | 'INCONCLUSIVE';

export interface ReproductionRun {
  id: string;
  incidentId: string;
  investigationId: string;
  status: ReproductionStatus;
  result: ReproductionResult | null;
  targetCommitSha: string | null;
  testFilePath: string | null;
  testExplanation: string | null;
  generatedTest: string | null;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export type FixStatus =
  | 'PENDING'
  | 'GENERATING_FIX'
  | 'VALIDATING_PATCH'
  | 'CREATING_SANDBOX'
  | 'CHECKING_OUT'
  | 'APPLYING_PATCH'
  | 'RUNNING_REPRODUCTION'
  | 'RUNNING_REGRESSION_TESTS'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED';

export type FixResult = 'FIX_VERIFIED' | 'FIX_REJECTED' | 'INCONCLUSIVE';

export interface FixPatchSummary {
  filePath: string;
  diff: string;
}

export interface FixValidationSummary {
  patchApplied: boolean;
  reproductionBeforeFix: { result: string | null; reason: string | null };
  postFixValidation: { outcome: string | null; reason: string | null };
  regressionTests: { outcome: string | null; total: number; failed: number; reason: string | null };
  result: FixResult;
}

export interface FixAttempt {
  id: string;
  incidentId: string;
  investigationId: string;
  reproductionRunId: string;
  status: FixStatus;
  result: FixResult | null;
  targetCommitSha: string | null;
  patch: string | null;
  changedFiles: string[];
  explanation: string | null;
  validationSummary: FixValidationSummary | null;
  stdout: string | null;
  stderr: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface FixAttemptDetail extends FixAttempt {
  patches: FixPatchSummary[];
}

export type PullRequestStatus = 'CREATING' | 'OPEN' | 'CLOSED' | 'MERGED' | 'FAILED';

export interface PullRequest {
  id: string;
  incidentId: string;
  fixAttemptId: string;
  repositoryId: string;
  branchName: string;
  baseBranch: string;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  title: string;
  body: string;
  status: PullRequestStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
