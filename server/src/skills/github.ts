/**
 * GitHubSkill — exposes GitHub operations as Claude tools in regular chat.
 *
 * Actions:
 *  - create_repo: Create a new GitHub repository
 *  - push_repo: Push a local git repo to GitHub (create remote + push)
 *  - create_pr: Create a pull request
 *  - repo_info: Get info about a repository
 *  - list_repos: List user's repositories
 *
 * Requires GITHUB_TOKEN in environment.
 */

import { BaseSkill, type SkillResult } from './base.js';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { ExternalServiceError } from '../errors.js';
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

const logger = createLogger('GitHubSkill');

// ---------------------------------------------------------------------------
// Skill implementation
// ---------------------------------------------------------------------------

export class GitHubSkill extends BaseSkill {
  readonly name = 'github';
  readonly description = 'Interact with GitHub — create repos, push code, create PRs, and more.';

  private octokit: Octokit | null = null;
  private username: string | null = null;

  getToolDefinition() {
    return {
      name: 'github',
      description:
        'Interact with GitHub repositories. Can create repos, push local code, create pull requests, get repo info, and list repos. Use this when the user wants to do anything with GitHub.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action: {
            type: 'string',
            enum: ['create_repo', 'push_repo', 'create_pr', 'repo_info', 'list_repos'],
            description: 'The GitHub operation to perform.',
          },
          name: {
            type: 'string',
            description: 'Repository name (for create_repo, push_repo, repo_info, create_pr).',
          },
          description: {
            type: 'string',
            description: 'Repository description (for create_repo).',
          },
          is_private: {
            type: 'boolean',
            description: 'Whether the repo should be private (default: false, for create_repo).',
          },
          local_path: {
            type: 'string',
            description: 'Absolute path to the local git repository to push (for push_repo).',
          },
          branch: {
            type: 'string',
            description: 'Branch name (for push_repo, create_pr). Defaults to "main".',
          },
          pr_title: {
            type: 'string',
            description: 'Pull request title (for create_pr).',
          },
          pr_body: {
            type: 'string',
            description: 'Pull request body/description (for create_pr).',
          },
          pr_head: {
            type: 'string',
            description: 'Head branch for PR (for create_pr).',
          },
          pr_base: {
            type: 'string',
            description: 'Base branch for PR (for create_pr). Defaults to "main".',
          },
        },
        required: ['action'],
      },
    };
  }

  async execute(params: Record<string, unknown>): Promise<SkillResult> {
    const action = typeof params['action'] === 'string' ? params['action'] : '';

    if (!config.githubToken) {
      return this.failure(
        'GitHub is not configured. Ask the administrator to add a GITHUB_TOKEN to the .env file.',
      );
    }

    try {
      if (!this.octokit) {
        this.octokit = new Octokit({ auth: config.githubToken });
      }
      if (!this.username) {
        const { data } = await this.octokit.users.getAuthenticated();
        this.username = data.login;
      }

      switch (action) {
        case 'create_repo':
          return this.createRepo(params);
        case 'push_repo':
          return this.pushRepo(params);
        case 'create_pr':
          return this.createPR(params);
        case 'repo_info':
          return this.repoInfo(params);
        case 'list_repos':
          return this.listRepos();
        default:
          return this.failure(
            `Unknown action "${action}". Available: create_repo, push_repo, create_pr, repo_info, list_repos`,
          );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('GitHub operation failed', { action, error: message });

      if (message.includes('already exists')) {
        return this.failure(`Repository already exists. Try a different name or use push_repo to push to the existing repo.`);
      }
      if (message.includes('Not Found')) {
        return this.failure(`Repository not found. Check the name and try again.`);
      }
      if (message.includes('Bad credentials') || message.includes('401')) {
        return this.failure(`GitHub authentication failed. The token may be invalid or expired.`);
      }
      if (err instanceof Error && !(err instanceof ExternalServiceError)) {
        throw new ExternalServiceError('GitHub', message, err);
      }
      return this.failure(`GitHub error: ${message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async createRepo(params: Record<string, unknown>): Promise<SkillResult> {
    const name = typeof params['name'] === 'string' ? params['name'].trim() : '';
    const description = typeof params['description'] === 'string' ? params['description'] : '';
    const isPrivate = params['is_private'] === true;

    if (!name) {
      return this.failure('Please provide a repository name.');
    }

    const { data } = await this.octokit!.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: false,
    });

    return this.success(
      `✅ Repository created!\n\n` +
      `*${this.escape(data.full_name)}*\n` +
      `🔗 ${data.html_url}\n` +
      `📋 Clone: \`${data.clone_url}\`\n` +
      `🔒 ${isPrivate ? 'Private' : 'Public'}`,
      { url: data.html_url, cloneUrl: data.clone_url, fullName: data.full_name },
    );
  }

  private async pushRepo(params: Record<string, unknown>): Promise<SkillResult> {
    const name = typeof params['name'] === 'string' ? params['name'].trim() : '';
    const localPath = typeof params['local_path'] === 'string' ? params['local_path'].trim() : '';
    const branch = typeof params['branch'] === 'string' ? params['branch'].trim() : 'main';

    if (!localPath) {
      return this.failure('Please provide the local_path to the git repository.');
    }

    // Verify it's a git repo
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: localPath, stdio: 'pipe' });
    } catch {
      return this.failure(`"${localPath}" is not a git repository.`);
    }

    const repoName = name || localPath.split('/').filter(Boolean).pop() || 'unnamed-repo';

    // Check if remote 'origin' already exists
    let remoteUrl = '';
    try {
      remoteUrl = execSync('git remote get-url origin', { cwd: localPath, stdio: 'pipe' }).toString().trim();
    } catch {
      // No remote — we'll create one
    }

    if (!remoteUrl) {
      // Check if repo exists on GitHub, create if not
      try {
        await this.octokit!.repos.get({ owner: this.username!, repo: repoName });
        logger.info('Repo already exists on GitHub, adding remote');
      } catch {
        // Create the repo
        await this.octokit!.repos.createForAuthenticatedUser({
          name: repoName,
          private: false,
          auto_init: false,
        });
        logger.info('Created new repo on GitHub', { name: repoName });
      }

      // Add remote with token auth
      const authUrl = `https://x-access-token:${config.githubToken}@github.com/${this.username}/${repoName}.git`;
      execSync(`git remote add origin "${authUrl}"`, { cwd: localPath, stdio: 'pipe' });
    }

    // Ensure remote URL has token for auth
    const authUrl = `https://x-access-token:${config.githubToken}@github.com/${this.username}/${repoName}.git`;
    try {
      execSync(`git remote set-url origin "${authUrl}"`, { cwd: localPath, stdio: 'pipe' });
    } catch {
      // Ignore if it fails
    }

    // Push
    try {
      const output = execSync(`git push -u origin ${branch} 2>&1`, {
        cwd: localPath,
        stdio: 'pipe',
        timeout: 60000,
      }).toString();

      const repoUrl = `https://github.com/${this.username}/${repoName}`;
      return this.success(
        `🚀 Code pushed to GitHub!\n\n` +
        `*${this.escape(this.username + '/' + repoName)}*\n` +
        `🔗 ${repoUrl}\n` +
        `🌿 Branch: \`${branch}\``,
        { url: repoUrl, branch, output },
      );
    } catch (err) {
      const stderr = err instanceof Error ? (err as NodeJS.ErrnoException & { stderr?: Buffer }).stderr?.toString() ?? err.message : String(err);
      return this.failure(`Push failed: ${stderr}`);
    }
  }

  private async createPR(params: Record<string, unknown>): Promise<SkillResult> {
    const name = typeof params['name'] === 'string' ? params['name'].trim() : '';
    const title = typeof params['pr_title'] === 'string' ? params['pr_title'] : '';
    const body = typeof params['pr_body'] === 'string' ? params['pr_body'] : '';
    const head = typeof params['pr_head'] === 'string' ? params['pr_head'] : '';
    const base = typeof params['pr_base'] === 'string' ? params['pr_base'] : 'main';

    if (!name) return this.failure('Please provide the repository name.');
    if (!title) return this.failure('Please provide a pr_title.');
    if (!head) return this.failure('Please provide pr_head (the source branch).');

    const { data } = await this.octokit!.pulls.create({
      owner: this.username!,
      repo: name,
      title,
      body,
      head,
      base,
    });

    return this.success(
      `✅ Pull Request created!\n\n` +
      `*#${data.number}: ${this.escape(data.title)}*\n` +
      `🔗 ${data.html_url}\n` +
      `🌿 \`${head}\` → \`${base}\``,
      { url: data.html_url, number: data.number },
    );
  }

  private async repoInfo(params: Record<string, unknown>): Promise<SkillResult> {
    const name = typeof params['name'] === 'string' ? params['name'].trim() : '';
    if (!name) return this.failure('Please provide a repository name.');

    // Support "owner/repo" or just "repo" (defaults to authenticated user)
    let owner = this.username!;
    let repo = name;
    if (name.includes('/')) {
      const parts = name.split('/');
      owner = parts[0]!;
      repo = parts[1]!;
    }

    const { data } = await this.octokit!.repos.get({ owner, repo });

    const lines = [
      `📦 *${this.escape(data.full_name)}*`,
      '',
      data.description ? `📝 ${this.escape(data.description)}` : '_No description_',
      `🔗 ${data.html_url}`,
      `🔒 ${data.private ? 'Private' : 'Public'}`,
      `🌿 Default branch: \`${data.default_branch}\``,
      `⭐ ${data.stargazers_count} stars | 🍴 ${data.forks_count} forks`,
      `📊 ${data.language ?? 'Unknown language'}`,
      `📅 Created: ${new Date(data.created_at ?? '').toLocaleDateString('en-GB')}`,
      `🔄 Last push: ${new Date(data.pushed_at ?? '').toLocaleDateString('en-GB')}`,
    ];

    return this.success(lines.join('\n'), { url: data.html_url });
  }

  private async listRepos(): Promise<SkillResult> {
    const { data } = await this.octokit!.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 15,
    });

    if (data.length === 0) {
      return this.success('You have no repositories yet. Use /github create\\_repo to create one.');
    }

    const lines = ['*Your Recent Repositories:*', ''];
    data.forEach((repo, i) => {
      const icon = repo.private ? '🔒' : '🌐';
      const lang = repo.language ? ` (${repo.language})` : '';
      lines.push(`${icon} *${i + 1}.* [${this.escape(repo.name)}](${repo.html_url})${lang}`);
      if (repo.description) {
        lines.push(`   _${this.escape(repo.description.slice(0, 80))}_`);
      }
    });

    lines.push('');
    lines.push(`_Showing ${data.length} most recently updated_`);

    return this.success(lines.join('\n'), { repos: data.map(r => ({ name: r.name, url: r.html_url })) });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private escape(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
  }
}
