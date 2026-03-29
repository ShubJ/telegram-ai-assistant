/**
 * GitHub client — wraps Octokit for repository and PR operations.
 */

import { Octokit } from '@octokit/rest';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import type { GitHubRepoInfo, GitHubPRInfo } from './types.js';

const logger = createLogger('GitHubClient');

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token?: string) {
    const authToken = token ?? config.githubToken;
    if (!authToken) {
      throw new Error('GitHub token not configured. Set GITHUB_TOKEN in your .env file.');
    }
    this.octokit = new Octokit({ auth: authToken });
  }

  /**
   * Create a new GitHub repository.
   */
  async createRepo(
    name: string,
    description: string,
    isPrivate = true,
  ): Promise<GitHubRepoInfo> {
    logger.info('Creating repository', { name, isPrivate });

    const { data } = await this.octokit.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: false,
    });

    return {
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
    };
  }

  /**
   * Get repository info.
   */
  async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    const { data } = await this.octokit.repos.get({ owner, repo });

    return {
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      cloneUrl: data.clone_url,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
    };
  }

  /**
   * Create a pull request.
   */
  async createPR(
    owner: string,
    repo: string,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<GitHubPRInfo> {
    logger.info('Creating pull request', { owner, repo, head, base, title });

    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      head,
      base,
      title,
      body,
    });

    return {
      number: data.number,
      htmlUrl: data.html_url,
      title: data.title,
      state: data.state,
      head: data.head.ref,
      base: data.base.ref,
    };
  }

  /**
   * Create a branch from the default branch.
   */
  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    fromBranch?: string,
  ): Promise<string> {
    const base = fromBranch ?? 'main';

    // Get the SHA of the base branch
    const { data: ref } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${base}`,
    });

    // Create new branch
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    logger.info('Branch created', { owner, repo, branchName, fromBranch: base });
    return branchName;
  }
}
