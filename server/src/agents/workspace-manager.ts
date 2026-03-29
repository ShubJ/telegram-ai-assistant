/**
 * Workspace manager — isolates each agent project in its own directory.
 *
 * Provides file I/O scoped to the project workspace and prevents path
 * traversal so agents cannot escape their sandbox.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createLogger } from '../logger.js';

const logger = createLogger('WorkspaceManager');

// Base directory for all generated projects
const PROJECTS_ROOT = path.resolve(process.env.HOME ?? '/home/ubuntu', 'Projects');

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

export class WorkspaceManager {
  /**
   * Create a new project workspace with git initialised.
   */
  createWorkspace(projectName: string): string {
    const safeName = this.sanitiseName(projectName);
    const wsPath = path.join(PROJECTS_ROOT, safeName);

    if (fs.existsSync(wsPath)) {
      logger.warn('Workspace already exists, reusing', { path: wsPath });
      return wsPath;
    }

    fs.mkdirSync(wsPath, { recursive: true });

    // Initialise git
    try {
      execSync('git init', { cwd: wsPath, stdio: 'pipe' });
      execSync('git checkout -b main', { cwd: wsPath, stdio: 'pipe' });
      logger.info('Workspace created', { path: wsPath });
    } catch (err) {
      logger.error('Git init failed', { path: wsPath, error: err instanceof Error ? err.message : String(err) });
    }

    return wsPath;
  }

  /**
   * Read a file from a project workspace.
   */
  readFile(workspacePath: string, filePath: string): string {
    const resolved = this.resolveAndGuard(workspacePath, filePath);
    if (!fs.existsSync(resolved)) {
      return '';
    }
    return fs.readFileSync(resolved, 'utf-8');
  }

  /**
   * Write a file to a project workspace. Creates directories as needed.
   */
  writeFile(workspacePath: string, filePath: string, content: string): void {
    const resolved = this.resolveAndGuard(workspacePath, filePath);
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    logger.debug('File written', { path: resolved, size: content.length });
  }

  /**
   * Delete a file from a project workspace.
   */
  deleteFile(workspacePath: string, filePath: string): void {
    const resolved = this.resolveAndGuard(workspacePath, filePath);
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      logger.debug('File deleted', { path: resolved });
    }
  }

  /**
   * List all files in a project workspace (recursively).
   */
  listFiles(workspacePath: string, subDir?: string): string[] {
    const base = subDir
      ? this.resolveAndGuard(workspacePath, subDir)
      : workspacePath;

    if (!fs.existsSync(base)) return [];

    const results: string[] = [];
    this.walkDir(base, workspacePath, results);
    return results;
  }

  /**
   * Delete an entire workspace.
   */
  deleteWorkspace(workspacePath: string): void {
    if (!workspacePath.startsWith(PROJECTS_ROOT)) {
      throw new Error('Cannot delete workspace outside projects root');
    }
    if (fs.existsSync(workspacePath)) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      logger.info('Workspace deleted', { path: workspacePath });
    }
  }

  /**
   * Get the workspace path for a project name.
   */
  getWorkspacePath(projectName: string): string {
    return path.join(PROJECTS_ROOT, this.sanitiseName(projectName));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve a file path within the workspace and guard against traversal.
   */
  private resolveAndGuard(workspacePath: string, filePath: string): string {
    const resolved = path.resolve(workspacePath, filePath);
    if (!resolved.startsWith(workspacePath)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }
    return resolved;
  }

  /**
   * Sanitise a project name for use as a directory name.
   */
  private sanitiseName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64) || 'untitled-project';
  }

  /**
   * Recursively walk a directory, collecting relative file paths.
   */
  private walkDir(dir: string, root: string, results: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      if (entry.isDirectory()) {
        this.walkDir(fullPath, root, results);
      } else {
        results.push(path.relative(root, fullPath));
      }
    }
  }
}
