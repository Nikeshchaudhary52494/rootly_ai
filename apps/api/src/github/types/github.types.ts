export interface GitHubRepositoryMetadata {
  owner: string;
  name: string;
  defaultBranch: string;
  private: boolean;
}

export type GitHubTreeEntryType = 'FILE' | 'DIRECTORY';

export interface GitHubTreeEntry {
  path: string;
  type: GitHubTreeEntryType;
  sha: string;
}

export interface GitHubCommitSummary {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  committedAt: string;
}
