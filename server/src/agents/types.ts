/**
 * Shared types, enums, and interfaces for the multi-agent system.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum AgentRole {
  PM = 'PM',
  EM = 'EM',
  TL = 'TL',
  SDE3 = 'SDE3',
  REVIEWER = 'REVIEWER',
  TESTER = 'TESTER',
  RESEARCHER = 'RESEARCHER',
  GITHUB = 'GITHUB',
  AUDITOR = 'AUDITOR',
}

export enum WorkflowPhase {
  IDLE = 'IDLE',
  ESTIMATING = 'ESTIMATING',
  RESEARCHING = 'RESEARCHING',
  PLANNING = 'PLANNING',
  DESIGNING = 'DESIGNING',
  TASK_SPLITTING = 'TASK_SPLITTING',
  CODING = 'CODING',
  REVIEWING = 'REVIEWING',
  TESTING = 'TESTING',
  AUDITING = 'AUDITING',
  SHIPPING = 'SHIPPING',
  COMPLETE = 'COMPLETE',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}

export enum MessageType {
  TASK = 'TASK',
  SUBMISSION = 'SUBMISSION',
  REVIEW = 'REVIEW',
  APPROVAL = 'APPROVAL',
  REJECTION = 'REJECTION',
  QUERY = 'QUERY',
  RESPONSE = 'RESPONSE',
  PROGRESS = 'PROGRESS',
}

export enum ReviewerSpecialty {
  CODE_QUALITY = 'CODE_QUALITY',
  SECURITY = 'SECURITY',
  PERFORMANCE = 'PERFORMANCE',
  CORRECTNESS = 'CORRECTNESS',
}

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface AgentMessage {
  id: string;
  timestamp: string;
  from: AgentRole;
  fromInstance?: string;
  to: AgentRole;
  toInstance?: string;
  type: MessageType;
  phase: WorkflowPhase;
  payload: {
    content: string;
    files?: FileChange[];
    metadata?: Record<string, unknown>;
  };
  parentMessageId?: string;
  projectId: string;
}

export interface FileChange {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface AgentProject {
  id: string;
  userId: string;
  type: 'project' | 'task';
  description: string;
  status: WorkflowPhase;
  workspacePath: string | null;
  sourceRepoPath: string | null;
  githubRepo: string | null;
  githubPrUrl: string | null;
  costEstimate: number | null;
  actualCost: number;
  chatId: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
}

/** Row shape as stored in SQLite (snake_case). */
export interface AgentProjectRow {
  id: string;
  user_id: string;
  type: string;
  description: string;
  status: string;
  workspace_path: string | null;
  source_repo_path: string | null;
  github_repo: string | null;
  github_pr_url: string | null;
  cost_estimate: number | null;
  actual_cost: number;
  chat_id: string;
  created_at: string;
  completed_at: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Workflow context
// ---------------------------------------------------------------------------

export interface WorkflowContext {
  project: AgentProject;
  messages: AgentMessage[];
  files: FileChange[];
  currentPhase: WorkflowPhase;
  tasksByAgent: Map<string, string[]>;
  errors: string[];
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

export type TaskComplexity = 'small' | 'medium' | 'large' | 'xl';

export interface CostEstimate {
  taskComplexity: TaskComplexity;
  estimatedCalls: number;
  estimatedTokens: number;
  estimatedCost: number;
  breakdown: Record<string, { calls: number; tokens: number; cost: number }>;
}

// ---------------------------------------------------------------------------
// Agent tool definitions (for agent-internal tools, not Telegram skills)
// ---------------------------------------------------------------------------

export interface AgentToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Workflow status (returned by orchestrator.getStatus)
// ---------------------------------------------------------------------------

export interface WorkflowStatus {
  projectId: string;
  phase: WorkflowPhase;
  description: string;
  progress: string;
  startedAt: string;
  error?: string;
}
