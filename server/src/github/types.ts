/**
 * GitHub integration types.
 */

export interface GitHubRepoInfo {
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface GitHubPRInfo {
  number: number;
  htmlUrl: string;
  title: string;
  state: string;
  head: string;
  base: string;
}
