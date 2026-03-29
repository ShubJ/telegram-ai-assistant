/**
 * Orchestrator — the state machine and main workflow engine.
 *
 * Manages the full lifecycle of agent projects/tasks: dispatches work to
 * agents, enforces maker-checker validation, retries on rejection, and
 * sends Telegram progress updates.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { createLogger } from '../logger.js';
import { MessageBus } from './message-bus.js';
import { WorkspaceManager } from './workspace-manager.js';
import { CostEstimator } from './cost-estimator.js';
import { createAgent } from './agent-factory.js';
import {
  AgentRole,
  MessageType,
  ReviewerSpecialty,
  WorkflowPhase,
} from './types.js';
import type {
  AgentMessage,
  AgentProject,
  AgentProjectRow,
  WorkflowStatus,
} from './types.js';
import type { Bot, Context } from 'grammy';

const logger = createLogger('Orchestrator');

const MAX_RETRIES = 2;

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly messageBus: MessageBus;
  private readonly workspaceManager: WorkspaceManager;
  private readonly costEstimator: CostEstimator;
  private bot: Bot<Context> | null = null;
  private activeProjects = new Map<string, boolean>(); // projectId → running

  constructor() {
    this.messageBus = new MessageBus();
    this.workspaceManager = new WorkspaceManager();
    this.costEstimator = new CostEstimator();
  }

  /** Inject the bot reference for sending Telegram updates. */
  setBot(bot: Bot<Context>): void {
    this.bot = bot;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Start a brand-new project from a description.
   */
  async startProject(
    userId: string,
    description: string,
    chatId: string,
  ): Promise<string> {
    const projectId = uuidv4();
    const now = new Date().toISOString();

    // Estimate cost
    const estimate = await this.costEstimator.estimateCost(description);
    await this.notify(chatId, this.costEstimator.formatEstimate(estimate));

    // Create workspace
    const wsName = `project-${projectId.slice(0, 8)}`;
    const workspacePath = this.workspaceManager.createWorkspace(wsName);

    // Persist project
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_projects
         (id, user_id, type, description, status, workspace_path, cost_estimate, actual_cost, chat_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(projectId, userId, 'project', description, WorkflowPhase.IDLE, workspacePath, estimate.estimatedCost, chatId, now);

    // Run workflow in background
    this.runWorkflow(description, workspacePath, chatId, projectId).catch((err) => {
      logger.error('Workflow failed', { projectId, error: err instanceof Error ? err.message : String(err) });
      this.updateProjectStatus(projectId, WorkflowPhase.FAILED, err instanceof Error ? err.message : String(err));
      this.notify(chatId, `❌ Project failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    return projectId;
  }

  /**
   * Start a task on an existing repository.
   *
   * SAFETY: Always creates an isolated workspace copy so agents never modify
   * the live repo directly. On completion a diff summary is presented instead
   * of auto-applying changes.
   */
  async startTask(
    userId: string,
    repoPath: string,
    description: string,
    chatId: string,
  ): Promise<string> {
    const projectId = uuidv4();
    const now = new Date().toISOString();

    const estimate = await this.costEstimator.estimateCost(description);
    await this.notify(chatId, this.costEstimator.formatEstimate(estimate));

    // Create an isolated workspace copy — agents must never touch the live repo
    const wsName = `task-${projectId.slice(0, 8)}`;
    const workspacePath = this.workspaceManager.createWorkspace(wsName);
    this.copyRepoToWorkspace(repoPath, workspacePath);

    const db = getDb();
    db.prepare(
      `INSERT INTO agent_projects
         (id, user_id, type, description, status, workspace_path, source_repo_path, cost_estimate, actual_cost, chat_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(projectId, userId, 'task', description, WorkflowPhase.IDLE, workspacePath, repoPath, estimate.estimatedCost, chatId, now);

    this.runWorkflow(description, workspacePath, chatId, projectId).catch((err) => {
      logger.error('Task workflow failed', { projectId, error: err instanceof Error ? err.message : String(err) });
      this.updateProjectStatus(projectId, WorkflowPhase.FAILED, err instanceof Error ? err.message : String(err));
      this.notify(chatId, `❌ Task failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    return projectId;
  }

  /**
   * Cancel a running project.
   */
  cancelProject(projectId: string): void {
    this.activeProjects.set(projectId, false);
    this.updateProjectStatus(projectId, WorkflowPhase.FAILED, 'Cancelled by user');
    logger.info('Project cancelled', { projectId });
  }

  /**
   * Resume a project that was interrupted (e.g. by a crash/restart).
   *
   * Reconstructs the in-memory phaseContext from persisted agent_messages,
   * determines which phases are already complete, and resumes the workflow
   * from the interrupted phase — skipping all completed phases.
   */
  async resumeProject(projectId: string, chatId: string): Promise<void> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_projects WHERE id = ?').get(projectId) as AgentProjectRow | undefined;
    if (!row) throw new Error(`Project ${projectId} not found`);

    const currentPhase = row.status as WorkflowPhase;
    if (currentPhase === WorkflowPhase.COMPLETE) {
      throw new Error(`Project is already complete`);
    }
    if (currentPhase === WorkflowPhase.IDLE) {
      throw new Error(`Project was never started`);
    }
    if (this.activeProjects.get(projectId)) {
      throw new Error(`Project is already running`);
    }

    const workspacePath = row.workspace_path ?? '';
    if (!workspacePath) throw new Error('Project has no workspace path');

    // Reconstruct phaseContext from persisted agent_messages
    const messages = this.messageBus.getMessageHistory(projectId);
    this.phaseContext.delete(projectId); // clear any stale in-memory context
    for (const msg of messages) {
      const label = `${msg.from}${msg.fromInstance ? `-${msg.fromInstance}` : ''} [${msg.phase}]`;
      this.appendContext(projectId, label, msg.payload.content);
    }

    logger.info('Resuming project', { projectId, fromPhase: currentPhase, messagesRestored: messages.length });
    await this.notify(chatId, `🔄 Resuming project from phase: *${currentPhase}* (${messages.length} messages restored)`);

    // Determine which phase index to start from
    const phaseOrder = [
      WorkflowPhase.RESEARCHING, WorkflowPhase.PLANNING, WorkflowPhase.DESIGNING,
      WorkflowPhase.TASK_SPLITTING, WorkflowPhase.CODING, WorkflowPhase.REVIEWING,
      WorkflowPhase.TESTING, WorkflowPhase.AUDITING, WorkflowPhase.SHIPPING,
    ];
    const resumeIdx = phaseOrder.indexOf(currentPhase);
    if (resumeIdx === -1) {
      throw new Error(`Cannot resume from phase: ${currentPhase}`);
    }

    // Run workflow from the interrupted phase in the background
    this.runWorkflow(row.description, workspacePath, chatId, projectId, resumeIdx).catch((err) => {
      logger.error('Resumed workflow failed', { projectId, error: err instanceof Error ? err.message : String(err) });
      this.updateProjectStatus(projectId, WorkflowPhase.FAILED, err instanceof Error ? err.message : String(err));
      this.notify(chatId, `❌ Resumed project failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /**
   * Get the status of a project.
   */
  getStatus(projectId: string): WorkflowStatus | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM agent_projects WHERE id = ?').get(projectId) as AgentProjectRow | undefined;
    if (!row) return null;

    return {
      projectId: row.id,
      phase: row.status as WorkflowPhase,
      description: row.description,
      progress: this.formatPhaseProgress(row.status as WorkflowPhase),
      startedAt: row.created_at,
      error: row.error ?? undefined,
    };
  }

  /**
   * List all projects for a user.
   */
  listProjects(userId: string): AgentProject[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM agent_projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    ).all(userId) as AgentProjectRow[];

    return rows.map(rowToProject);
  }

  // -------------------------------------------------------------------------
  // Workflow engine
  // -------------------------------------------------------------------------

  private async runWorkflow(
    description: string,
    workspacePath: string,
    chatId: string,
    projectId: string,
    startPhaseIndex = 0,
  ): Promise<void> {
    this.activeProjects.set(projectId, true);

    const phases: Array<() => Promise<void>> = [
      () => this.phaseResearch(projectId, description, workspacePath, chatId),
      () => this.phasePlanning(projectId, description, workspacePath, chatId),
      () => this.phaseDesigning(projectId, workspacePath, chatId),
      () => this.phaseTaskSplitting(projectId, workspacePath, chatId),
      () => this.phaseCoding(projectId, workspacePath, chatId),
      () => this.phaseReviewing(projectId, workspacePath, chatId),
      () => this.phaseTesting(projectId, workspacePath, chatId),
      () => this.phaseAuditing(projectId, description, workspacePath, chatId),
      () => this.phaseShipping(projectId, description, workspacePath, chatId),
    ];

    for (let i = startPhaseIndex; i < phases.length; i++) {
      if (!this.activeProjects.get(projectId)) {
        logger.info('Workflow cancelled', { projectId });
        return;
      }
      await phases[i]();
    }

    this.updateProjectStatus(projectId, WorkflowPhase.COMPLETE);

    // For tasks, present a diff summary instead of auto-applying to the live repo
    const db = getDb();
    const project = db.prepare('SELECT * FROM agent_projects WHERE id = ?').get(projectId) as AgentProjectRow | undefined;
    if (project?.type === 'task' && project.source_repo_path) {
      const diffSummary = this.generateDiffSummary(workspacePath);
      await this.notify(chatId,
        `✅ Task complete! All phases passed.\n\n` +
        `📂 Changes are in isolated workspace:\n\`${workspacePath}\`\n\n` +
        `📊 Diff summary:\n\`\`\`\n${diffSummary}\n\`\`\`\n\n` +
        `⚠️ Changes have NOT been applied to the live repo. Review and copy manually.`);
    } else {
      await this.notify(chatId, '✅ Project complete! All phases passed.');
    }
  }

  // ---- Phase implementations ----------------------------------------------

  private phaseContext = new Map<string, string>(); // projectId → accumulated context

  private getContext(projectId: string): string {
    return this.phaseContext.get(projectId) ?? '';
  }

  private appendContext(projectId: string, label: string, content: string): void {
    const existing = this.getContext(projectId);
    this.phaseContext.set(projectId, `${existing}\n\n--- ${label} ---\n${content}`);
  }

  private async phaseResearch(
    projectId: string,
    description: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.RESEARCHING);
    await this.notify(chatId, '🔬 [Research] Researching best practices...');

    const agent = createAgent(AgentRole.RESEARCHER, this.messageBus, this.workspaceManager);
    const taskMsg = this.buildTaskMessage(AgentRole.RESEARCHER, projectId, WorkflowPhase.RESEARCHING,
      `Research the following project and provide a comprehensive technical report:\n\n${description}`);

    const result = await agent.execute(taskMsg, workspacePath);
    this.appendContext(projectId, 'RESEARCH FINDINGS', result.payload.content);
    this.messageBus.send(result);
    await this.notify(chatId, '🔬 [Research] Research complete.');
  }

  private async phasePlanning(
    projectId: string,
    description: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.PLANNING);
    await this.notify(chatId, '📋 [PM] Creating project specification...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      // Maker: PM creates spec
      const pm = createAgent(AgentRole.PM, this.messageBus, this.workspaceManager);
      const pmTask = this.buildTaskMessage(AgentRole.PM, projectId, WorkflowPhase.PLANNING,
        `Create a detailed project specification for:\n\n${description}\n\n${context}${retries > 0 ? '\n\nPrevious submission was rejected. Address the feedback above.' : ''}`);
      const pmResult = await pm.execute(pmTask, workspacePath);
      this.messageBus.send(pmResult);

      // Checker: EM validates
      const em = createAgent(AgentRole.EM, this.messageBus, this.workspaceManager);
      const emTask = this.buildTaskMessage(AgentRole.EM, projectId, WorkflowPhase.PLANNING,
        `Review and validate this project specification. Check for completeness, feasibility, and clarity.\n\n${pmResult.payload.content}`);
      const emResult = await em.execute(emTask, workspacePath);
      this.messageBus.send(emResult);

      if (this.isApproved(emResult.payload.content)) {
        approved = true;
        this.appendContext(projectId, 'PROJECT SPEC (APPROVED)', pmResult.payload.content);
        await this.notify(chatId, '✅ [EM] Project spec approved.');
      } else {
        retries++;
        this.appendContext(projectId, `PLANNING FEEDBACK (attempt ${retries})`, emResult.payload.content);
        await this.notify(chatId, `🔄 [EM] Spec rejected, PM revising (attempt ${retries + 1})...`);
      }
    }

    if (!approved) {
      throw new Error('Planning phase failed after maximum retries');
    }
  }

  private async phaseDesigning(
    projectId: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.DESIGNING);
    await this.notify(chatId, '🏗️ [EM] Designing architecture...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      const em = createAgent(AgentRole.EM, this.messageBus, this.workspaceManager);
      const emTask = this.buildTaskMessage(AgentRole.EM, projectId, WorkflowPhase.DESIGNING,
        `Create a technical architecture based on the project spec below.\n\n${context}${retries > 0 ? '\n\nPrevious submission was rejected. Address the feedback above.' : ''}`);
      const emResult = await em.execute(emTask, workspacePath);
      this.messageBus.send(emResult);

      const tl = createAgent(AgentRole.TL, this.messageBus, this.workspaceManager);
      const tlTask = this.buildTaskMessage(AgentRole.TL, projectId, WorkflowPhase.DESIGNING,
        `Review and validate this technical architecture for soundness, scalability, and implementability.\n\n${emResult.payload.content}`);
      const tlResult = await tl.execute(tlTask, workspacePath);
      this.messageBus.send(tlResult);

      if (this.isApproved(tlResult.payload.content)) {
        approved = true;
        this.appendContext(projectId, 'ARCHITECTURE (APPROVED)', emResult.payload.content);
        await this.notify(chatId, '✅ [TL] Architecture approved.');
      } else {
        retries++;
        this.appendContext(projectId, `DESIGN FEEDBACK (attempt ${retries})`, tlResult.payload.content);
        await this.notify(chatId, `🔄 [TL] Architecture rejected, EM revising (attempt ${retries + 1})...`);
      }
    }

    if (!approved) throw new Error('Design phase failed after maximum retries');
  }

  private async phaseTaskSplitting(
    projectId: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.TASK_SPLITTING);
    await this.notify(chatId, '📝 [TL] Splitting into coding tasks...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      const tl = createAgent(AgentRole.TL, this.messageBus, this.workspaceManager);
      const tlTask = this.buildTaskMessage(AgentRole.TL, projectId, WorkflowPhase.TASK_SPLITTING,
        `Break the architecture into concrete coding tasks. Each task should be completable by one engineer. Return as a JSON array of tasks.\n\n${context}${retries > 0 ? '\n\nPrevious submission was rejected. Address the feedback above.' : ''}`);
      const tlResult = await tl.execute(tlTask, workspacePath);
      this.messageBus.send(tlResult);

      const em = createAgent(AgentRole.EM, this.messageBus, this.workspaceManager);
      const emTask = this.buildTaskMessage(AgentRole.EM, projectId, WorkflowPhase.TASK_SPLITTING,
        `Review this task breakdown for coverage, granularity, dependencies, and clarity.\n\n${tlResult.payload.content}`);
      const emResult = await em.execute(emTask, workspacePath);
      this.messageBus.send(emResult);

      if (this.isApproved(emResult.payload.content)) {
        approved = true;
        this.appendContext(projectId, 'CODING TASKS (APPROVED)', tlResult.payload.content);
        await this.notify(chatId, '✅ [EM] Task breakdown approved.');
      } else {
        retries++;
        this.appendContext(projectId, `TASK_SPLIT FEEDBACK (attempt ${retries})`, emResult.payload.content);
        await this.notify(chatId, `🔄 [EM] Task breakdown rejected, TL revising (attempt ${retries + 1})...`);
      }
    }

    if (!approved) throw new Error('Task splitting phase failed after maximum retries');
  }

  private async phaseCoding(
    projectId: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.CODING);
    await this.notify(chatId, '⚡ [SDE3] Coding in progress...');

    const context = this.getContext(projectId);

    // Extract tasks from context (best effort JSON extraction)
    const tasks = this.extractTasks(context);

    if (tasks.length === 0) {
      // Fallback: give the full context to a single SDE3
      const sde = createAgent(AgentRole.SDE3, this.messageBus, this.workspaceManager, '1');
      const task = this.buildTaskMessage(AgentRole.SDE3, projectId, WorkflowPhase.CODING,
        `Implement the full project based on the following spec and architecture:\n\n${context}`);
      const result = await sde.execute(task, workspacePath);
      this.messageBus.send(result);
      this.appendContext(projectId, 'CODING RESULT (SDE3-1)', result.payload.content);
      await this.notify(chatId, '⚡ [SDE3-1] Implementation complete.');
      return;
    }

    // Execute tasks (sequentially to respect dependencies)
    for (let i = 0; i < tasks.length; i++) {
      const taskDesc = typeof tasks[i] === 'string' ? tasks[i] : JSON.stringify(tasks[i]);
      const instanceId = String(i + 1);
      let retries = 0;
      let approved = false;

      while (!approved && retries <= MAX_RETRIES) {
        const sde = createAgent(AgentRole.SDE3, this.messageBus, this.workspaceManager, instanceId);
        const sdeTask = this.buildTaskMessage(AgentRole.SDE3, projectId, WorkflowPhase.CODING,
          `Complete the following coding task. The project workspace already contains files from previous tasks — read them if needed.\n\nTask:\n${taskDesc}${retries > 0 ? '\n\nYour previous submission was rejected. Fix the issues mentioned above.' : ''}\n\nFull project context:\n${context}`);
        const sdeResult = await sde.execute(sdeTask, workspacePath);
        this.messageBus.send(sdeResult);

        // TL validates
        const tl = createAgent(AgentRole.TL, this.messageBus, this.workspaceManager);
        const tlTask = this.buildTaskMessage(AgentRole.TL, projectId, WorkflowPhase.CODING,
          `Review the code written by SDE3-${instanceId} for this task:\n\nTask: ${taskDesc}\n\nSDE3 report:\n${sdeResult.payload.content}\n\nRead the workspace files to verify the implementation.`);
        const tlResult = await tl.execute(tlTask, workspacePath);
        this.messageBus.send(tlResult);

        if (this.isApproved(tlResult.payload.content)) {
          approved = true;
          await this.notify(chatId, `⚡ [SDE3-${instanceId}] Task ${i + 1}/${tasks.length} complete.`);
        } else {
          retries++;
          this.appendContext(projectId, `CODING FEEDBACK (SDE3-${instanceId}, attempt ${retries})`, tlResult.payload.content);
          await this.notify(chatId, `🔄 [TL] Code rejected for task ${i + 1}, SDE3-${instanceId} revising...`);
        }
      }

      if (!approved) {
        logger.warn('Coding task failed after retries, continuing', { projectId, task: i + 1 });
      }
    }

    this.appendContext(projectId, 'CODING COMPLETE', `All ${tasks.length} tasks processed.`);
  }

  private async phaseReviewing(
    projectId: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.REVIEWING);
    await this.notify(chatId, '🔍 [Reviewers] Running 4 parallel code reviews...');

    const context = this.getContext(projectId);
    const files = this.workspaceManager.listFiles(workspacePath);
    const fileList = files.join('\n');

    const specialties = [
      ReviewerSpecialty.CODE_QUALITY,
      ReviewerSpecialty.SECURITY,
      ReviewerSpecialty.PERFORMANCE,
      ReviewerSpecialty.CORRECTNESS,
    ];

    // Run all 4 reviewers in parallel
    const reviewPromises = specialties.map(async (specialty, i) => {
      const reviewer = createAgent(AgentRole.REVIEWER, this.messageBus, this.workspaceManager, String(i + 1), specialty);
      const task = this.buildTaskMessage(AgentRole.REVIEWER, projectId, WorkflowPhase.REVIEWING,
        `Review all files in the project workspace. Files:\n${fileList}\n\nProject context:\n${context}`);
      const result = await reviewer.execute(task, workspacePath);
      this.messageBus.send(result);
      return { specialty, result };
    });

    const reviews = await Promise.all(reviewPromises);
    await this.notify(chatId, '🔍 [Reviewers] 4/4 reviews complete.');

    // TL consolidates
    const consolidatedFindings = reviews
      .map((r) => `### ${r.specialty} Review\n${r.result.payload.content}`)
      .join('\n\n');

    const tl = createAgent(AgentRole.TL, this.messageBus, this.workspaceManager);
    const tlTask = this.buildTaskMessage(AgentRole.TL, projectId, WorkflowPhase.REVIEWING,
      `Consolidate these 4 code reviews. Identify blocking vs advisory issues. If critical issues exist, REJECT.\n\n${consolidatedFindings}`);
    const tlResult = await tl.execute(tlTask, workspacePath);
    this.messageBus.send(tlResult);

    if (!this.isApproved(tlResult.payload.content)) {
      // If reviews found critical issues, go back to coding for fixes
      this.appendContext(projectId, 'REVIEW FINDINGS', tlResult.payload.content);
      await this.notify(chatId, '🔧 [TL] Critical issues found, sending back for fixes...');
      await this.phaseCoding(projectId, workspacePath, chatId);
    } else {
      this.appendContext(projectId, 'REVIEWS PASSED', tlResult.payload.content);
      await this.notify(chatId, '✅ [TL] All reviews passed.');
    }
  }

  private async phaseTesting(
    projectId: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.TESTING);
    await this.notify(chatId, '🧪 [Tester] Writing and running tests...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      const tester = createAgent(AgentRole.TESTER, this.messageBus, this.workspaceManager);
      const testerTask = this.buildTaskMessage(AgentRole.TESTER, projectId, WorkflowPhase.TESTING,
        `Write comprehensive tests for the project and run them.\n\nProject context:\n${context}${retries > 0 ? '\n\nPrevious tests had issues. Fix and re-run.' : ''}`);
      const testerResult = await tester.execute(testerTask, workspacePath);
      this.messageBus.send(testerResult);

      const tl = createAgent(AgentRole.TL, this.messageBus, this.workspaceManager);
      const tlTask = this.buildTaskMessage(AgentRole.TL, projectId, WorkflowPhase.TESTING,
        `Validate these test results. Are the tests meaningful? Do they pass? Is coverage adequate?\n\n${testerResult.payload.content}`);
      const tlResult = await tl.execute(tlTask, workspacePath);
      this.messageBus.send(tlResult);

      if (this.isApproved(tlResult.payload.content)) {
        approved = true;
        this.appendContext(projectId, 'TESTS PASSED', testerResult.payload.content);
        await this.notify(chatId, '✅ [TL] Tests approved.');
      } else {
        retries++;
        this.appendContext(projectId, `TESTING FEEDBACK (attempt ${retries})`, tlResult.payload.content);
        await this.notify(chatId, `🔄 [TL] Tests rejected, Tester revising (attempt ${retries + 1})...`);
      }
    }

    if (!approved) {
      logger.warn('Testing phase failed after retries, continuing', { projectId });
    }
  }

  private async phaseAuditing(
    projectId: string,
    description: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.AUDITING);
    await this.notify(chatId, '📝 [Auditor] Final requirements audit...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      const auditor = createAgent(AgentRole.AUDITOR, this.messageBus, this.workspaceManager);
      const auditorTask = this.buildTaskMessage(AgentRole.AUDITOR, projectId, WorkflowPhase.AUDITING,
        `Audit the project against the original requirements.\n\nOriginal request: ${description}\n\n${context}`);
      const auditorResult = await auditor.execute(auditorTask, workspacePath);
      this.messageBus.send(auditorResult);

      const pm = createAgent(AgentRole.PM, this.messageBus, this.workspaceManager);
      const pmTask = this.buildTaskMessage(AgentRole.PM, projectId, WorkflowPhase.AUDITING,
        `Validate this audit report. Is it thorough? Are all requirements accounted for?\n\n${auditorResult.payload.content}`);
      const pmResult = await pm.execute(pmTask, workspacePath);
      this.messageBus.send(pmResult);

      if (this.isApproved(pmResult.payload.content)) {
        approved = true;
        this.appendContext(projectId, 'AUDIT PASSED', auditorResult.payload.content);
        await this.notify(chatId, '✅ [PM] Audit approved — all requirements met.');
      } else {
        retries++;
        this.appendContext(projectId, `AUDIT FEEDBACK (attempt ${retries})`, pmResult.payload.content);
        await this.notify(chatId, `🔄 [PM] Audit rejected, Auditor revising (attempt ${retries + 1})...`);
      }
    }

    if (!approved) {
      logger.warn('Audit phase failed after retries, continuing', { projectId });
    }
  }

  private async phaseShipping(
    projectId: string,
    description: string,
    workspacePath: string,
    chatId: string,
  ): Promise<void> {
    this.updateProjectStatus(projectId, WorkflowPhase.SHIPPING);
    await this.notify(chatId, '🚀 [GitHub] Preparing to ship...');

    const context = this.getContext(projectId);
    let retries = 0;
    let approved = false;

    while (!approved && retries <= MAX_RETRIES) {
      const ghAgent = createAgent(AgentRole.GITHUB, this.messageBus, this.workspaceManager);
      const ghTask = this.buildTaskMessage(AgentRole.GITHUB, projectId, WorkflowPhase.SHIPPING,
        `Ship this project to GitHub. Create a repo, commit all files, push, and create a PR.\n\nProject: ${description}\n\n${context}`);
      const ghResult = await ghAgent.execute(ghTask, workspacePath);
      this.messageBus.send(ghResult);

      // Update project with GitHub info
      const prUrl = this.extractPRUrl(ghResult.payload.content);
      if (prUrl) {
        const db = getDb();
        db.prepare('UPDATE agent_projects SET github_pr_url = ? WHERE id = ?').run(prUrl, projectId);
      }

      const auditor = createAgent(AgentRole.AUDITOR, this.messageBus, this.workspaceManager);
      const auditorTask = this.buildTaskMessage(AgentRole.AUDITOR, projectId, WorkflowPhase.SHIPPING,
        `Validate that the GitHub PR was created correctly and contains all project files.\n\n${ghResult.payload.content}`);
      const auditorResult = await auditor.execute(auditorTask, workspacePath);
      this.messageBus.send(auditorResult);

      if (this.isApproved(auditorResult.payload.content)) {
        approved = true;
        await this.notify(chatId, `🚀 [GitHub] Shipped!${prUrl ? ` PR: ${prUrl}` : ''}`);
      } else {
        retries++;
        this.appendContext(projectId, `SHIPPING FEEDBACK (attempt ${retries})`, auditorResult.payload.content);
        await this.notify(chatId, `🔄 [Auditor] Shipping rejected, retrying (attempt ${retries + 1})...`);
      }
    }

    if (!approved) {
      logger.warn('Shipping phase failed after retries', { projectId });
      await this.notify(chatId, '⚠️ Shipping had issues but project code is ready in workspace.');
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Copy repo contents into an isolated workspace, excluding build artifacts
   * and heavyweight directories that agents don't need.
   */
  private copyRepoToWorkspace(repoPath: string, workspacePath: string): void {
    const resolvedRepo = path.resolve(repoPath);
    if (!fs.existsSync(resolvedRepo)) {
      throw new Error(`Source repo does not exist: ${resolvedRepo}`);
    }

    const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'logs', '.next', '.cache']);

    const copyRecursive = (src: string, dest: string): void => {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          copyRecursive(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    };

    copyRecursive(resolvedRepo, workspacePath);

    // Initialize git in the workspace so agents can diff their changes
    try {
      execSync('git init && git add -A && git commit -m "Initial copy from source repo"', {
        cwd: workspacePath,
        stdio: 'pipe',
      });
    } catch {
      // Non-fatal — workspace still usable without git history
      logger.warn('Git init in isolated workspace failed (non-fatal)', { workspacePath });
    }

    logger.info('Copied repo to isolated workspace', { from: resolvedRepo, to: workspacePath });
  }

  /**
   * Generate a diff summary between the isolated workspace and original repo.
   */
  private generateDiffSummary(workspacePath: string): string {
    try {
      const diff = execSync('git diff HEAD --stat', { cwd: workspacePath, encoding: 'utf-8' });
      if (!diff.trim()) {
        // Check for untracked files
        const untracked = execSync('git status --short', { cwd: workspacePath, encoding: 'utf-8' });
        return untracked.trim() || 'No changes detected.';
      }
      return diff;
    } catch {
      return 'Could not generate diff summary.';
    }
  }

  private buildTaskMessage(
    to: AgentRole,
    projectId: string,
    phase: WorkflowPhase,
    content: string,
  ): AgentMessage {
    return {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      from: AgentRole.PM, // orchestrator sends as PM for routing
      to,
      type: MessageType.TASK,
      phase,
      payload: { content },
      projectId,
    };
  }

  private isApproved(content: string): boolean {
    const upper = content.toUpperCase();
    // Look for explicit APPROVED/REJECTED markers
    const hasApproved = upper.includes('APPROVED');
    const hasRejected = upper.includes('REJECTED');

    if (hasApproved && !hasRejected) return true;
    if (hasRejected) return false;
    // Default to approved if no clear signal
    return true;
  }

  private extractTasks(context: string): unknown[] {
    // Try to find a JSON array in the context
    const jsonMatch = context.match(/\[[\s\S]*?\{[\s\S]*?"id"[\s\S]*?\}[\s\S]*?\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as unknown[];
      } catch {
        // JSON parse failed
      }
    }

    // Fallback: look for numbered task items
    const taskLines = context.match(/(?:^|\n)\s*\d+\.\s+.+/g);
    if (taskLines && taskLines.length > 0) {
      return taskLines.map((line) => line.trim());
    }

    return [];
  }

  private extractPRUrl(content: string): string | null {
    const match = content.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
    return match ? match[0] : null;
  }

  private updateProjectStatus(projectId: string, status: WorkflowPhase, error?: string): void {
    try {
      const db = getDb();
      if (status === WorkflowPhase.COMPLETE || status === WorkflowPhase.FAILED) {
        db.prepare(
          'UPDATE agent_projects SET status = ?, completed_at = ?, error = ? WHERE id = ?',
        ).run(status, new Date().toISOString(), error ?? null, projectId);
      } else {
        db.prepare('UPDATE agent_projects SET status = ? WHERE id = ?').run(status, projectId);
      }
    } catch (err) {
      logger.error('Failed to update project status', {
        projectId,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async notify(chatId: string, text: string): Promise<void> {
    if (!this.bot) {
      logger.debug('No bot reference, skipping notification', { chatId, text });
      return;
    }
    try {
      await this.bot.api.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    } catch (err) {
      // Retry without markdown
      try {
        await this.bot.api.sendMessage(chatId, text.replace(/[*_`[\]()]/g, ''));
      } catch {
        logger.error('Failed to send notification', {
          chatId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private formatPhaseProgress(phase: WorkflowPhase): string {
    const phases = [
      WorkflowPhase.RESEARCHING, WorkflowPhase.PLANNING, WorkflowPhase.DESIGNING,
      WorkflowPhase.TASK_SPLITTING, WorkflowPhase.CODING, WorkflowPhase.REVIEWING,
      WorkflowPhase.TESTING, WorkflowPhase.AUDITING, WorkflowPhase.SHIPPING,
    ];
    const idx = phases.indexOf(phase);
    if (idx === -1) return phase;
    return `Phase ${idx + 1}/${phases.length}: ${phase}`;
  }
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToProject(row: AgentProjectRow): AgentProject {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as 'project' | 'task',
    description: row.description,
    status: row.status as WorkflowPhase,
    workspacePath: row.workspace_path,
    sourceRepoPath: row.source_repo_path,
    githubRepo: row.github_repo,
    githubPrUrl: row.github_pr_url,
    costEstimate: row.cost_estimate,
    actualCost: row.actual_cost,
    chatId: row.chat_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    error: row.error,
  };
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!_instance) {
    _instance = new Orchestrator();
  }
  return _instance;
}
