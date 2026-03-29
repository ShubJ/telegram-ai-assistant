# Multi-Agent Software Engineering System — Implementation Plan

## Overview

A self-orchestrating multi-agent system built into the Telegram bot that simulates
a full engineering org. Every action has maker-checker validation, agents communicate
through a structured message bus, and the system can research, plan, code, review,
test, and ship autonomously.

---

## Architecture

### Core Components

```
server/src/
├── agents/                    # Multi-agent system
│   ├── types.ts               # Shared types, enums, interfaces
│   ├── message-bus.ts         # Inter-agent communication
│   ├── orchestrator.ts        # State machine + workflow engine
│   ├── cost-estimator.ts      # Budget estimation before execution
│   ├── workspace-manager.ts   # Isolated project workspaces
│   ├── base-agent.ts          # Abstract base agent class
│   ├── agent-factory.ts       # Creates agent instances by role
│   ├── roles/                 # Individual agent implementations
│   │   ├── pm.ts              # Product Manager
│   │   ├── em.ts              # Engineering Manager
│   │   ├── tl.ts              # Tech Lead
│   │   ├── sde3.ts            # Senior Developer (multiple instances)
│   │   ├── reviewer.ts        # Code Reviewer (multiple instances)
│   │   ├── tester.ts          # Tester
│   │   ├── researcher.ts      # Web Research Agent
│   │   ├── github-agent.ts    # GitHub operations
│   │   └── auditor.ts         # Final validation agent
│   └── index.ts               # Public API + skill registration
├── github/                    # GitHub integration
│   ├── client.ts              # Octokit wrapper
│   └── types.ts               # GitHub-specific types
```

### Agent Roster

| Agent         | Count | Role                                        | Tools                                    |
|---------------|-------|---------------------------------------------|------------------------------------------|
| PM            | 1     | Requirements, project plan, prioritisation  | research results, spec writing           |
| EM            | 1     | Architecture, resource allocation, scoping  | system design, risk assessment           |
| TL            | 1     | Technical design, task split, coordination  | code review, conflict resolution         |
| SDE3          | 3     | Write code, one module each                 | file write, dependency mgmt              |
| Reviewer      | 4     | Quality, security, performance, correctness | file read, static analysis               |
| Tester        | 1     | Write + run tests, coverage                 | test runner, file ops                    |
| Researcher    | 1     | Web search, best practices                  | brave search, web fetch                  |
| GitHub Agent  | 1     | Git ops, PR creation                        | git CLI, GitHub API                      |
| Auditor       | 1     | Final validation against requirements       | file read, cross-reference               |

---

## Workflow State Machine

```
IDLE
  │
  ▼ (user sends task)
ESTIMATING ──── (over budget?) ──→ REJECTED (notify user)
  │
  ▼
RESEARCHING
  │ Research Agent searches web for best practices
  ▼
PLANNING
  │ PM creates project spec
  │ EM validates (checker) → reject loops back to PM
  ▼
DESIGNING
  │ EM creates architecture
  │ TL validates (checker) → reject loops back to EM
  ▼
TASK_SPLITTING
  │ TL breaks into coding tasks
  │ EM validates (checker)
  ▼
CODING
  │ SDE3 agents work in parallel (one task each)
  │ Each SDE3 → TL validates (checker)
  │ Reject → back to specific SDE3
  ▼
REVIEWING
  │ 4 Reviewers work in parallel:
  │   - Code Quality Reviewer
  │   - Security Reviewer
  │   - Performance Reviewer
  │   - Correctness Reviewer
  │ All findings → TL consolidates
  │ If critical issues → back to CODING
  ▼
TESTING
  │ Tester writes + runs tests
  │ TL validates test results (checker)
  │ If failures → back to CODING
  ▼
AUDITING
  │ Auditor checks output against original requirements
  │ PM validates audit (checker)
  │ If gaps → back to appropriate phase
  ▼
SHIPPING
  │ GitHub Agent: create branch, commit, push, open PR
  │ Auditor validates PR content (checker)
  ▼
COMPLETE
  │ Final report → user via Telegram
```

---

## Maker-Checker Matrix

| Phase          | Maker          | Checker        | Reject Target  |
|----------------|----------------|----------------|----------------|
| Project Plan   | PM             | EM             | PM             |
| Architecture   | EM             | TL             | EM             |
| Task Split     | TL             | EM             | TL             |
| Code           | SDE3 (each)    | TL             | Same SDE3      |
| Code Review    | Reviewers (4)  | TL             | SDE3s          |
| Tests          | Tester         | TL             | Tester/SDE3    |
| Audit          | Auditor        | PM             | Varies         |
| PR/Ship        | GitHub Agent   | Auditor        | GitHub Agent   |

---

## Message Bus Design

```typescript
interface AgentMessage {
  id: string;
  timestamp: string;
  from: AgentRole;
  fromInstance?: string;      // e.g. "SDE3-1", "Reviewer-2"
  to: AgentRole;
  toInstance?: string;
  type: MessageType;          // task | submission | review | approval | rejection | query | response
  phase: WorkflowPhase;
  payload: {
    content: string;          // The actual message/instruction
    files?: FileChange[];     // Code changes
    metadata?: Record<string, unknown>;
  };
  parentMessageId?: string;   // For threading
  projectId: string;
}
```

Agents do NOT share memory or modify each other's state. Communication is
strictly through the message bus. The orchestrator routes messages.

---

## Cost Estimation

Before starting any workflow:

1. Classify task complexity: small / medium / large / xl
2. Estimate agent calls per phase:
   - Small:  ~12 calls (research=1, plan=2, design=2, code=1+1, review=4+1, test=1+1)
   - Medium: ~20 calls (more code rounds, retry loops)
   - Large:  ~35 calls (multiple coding iterations)
   - XL:     ~50+ calls

3. Estimate tokens per call based on model:
   - Haiku:  avg 2K in + 1K out per call → ~$0.002/call
   - Sonnet: avg 3K in + 2K out per call → ~$0.02/call

4. Present estimate to user:
   "Estimated cost: $0.05-0.10 (12-15 agent calls using claude-haiku)"
   "Your remaining budget: $X.XX"
   "Proceed? This will start automatically."

---

## Workspace Manager

Each new project gets an isolated workspace:

```
~/Projects/
├── telegram-ai-assistant/     # This project (the bot itself)
├── project-alpha/             # Generated project 1
├── project-beta/              # Generated project 2
└── ...
```

The workspace manager:
- Creates project directories
- Initialises git repos
- Manages file read/write per agent (agents specify which files to create/modify)
- Prevents agents from touching files outside their workspace
- Tracks file ownership (which agent created/modified each file)

---

## GitHub Integration

Using `octokit` (official GitHub SDK):

- `createRepo(name, description, isPrivate)`
- `createBranch(repo, branchName, fromBranch)`
- `commitFiles(repo, branch, files, message)`
- `createPR(repo, head, base, title, body)`
- `getRepoInfo(repo)`

---

## Telegram Interface

### New Commands

- `/project <description>` — Start a new project (triggers full workflow)
- `/task <repo> <description>` — Add feature/fix to existing project
- `/agents status` — Show running agent workflows
- `/agents cancel <projectId>` — Cancel a running workflow
- `/agents budget` — Show remaining budget estimate
- `/agents history` — Past project/task results

### Progress Updates

The bot sends progress messages as agents complete phases:

```
🔬 [Research] Researching best practices for React dashboard...
📋 [PM] Project plan created (12 requirements, 3 milestones)
✅ [EM] Architecture approved
🏗️ [TL] Split into 4 coding tasks
⚡ [SDE3-1] Completed: Authentication module (143 lines)
⚡ [SDE3-2] Completed: Dashboard layout (267 lines)
⚡ [SDE3-3] Completed: API routes (198 lines)
🔍 [Reviewers] 4/4 complete — 2 minor issues found
🔧 [SDE3-1] Fixed: Input validation on login
✅ [TL] All reviews passed
🧪 [Tester] 23 tests written, 23 passing
📝 [Auditor] All 12 requirements verified ✓
🚀 [GitHub] PR #1 opened: github.com/user/project/pull/1
```

---

## Anti-Hallucination Measures

1. **Research-backed**: PM/EM decisions are informed by Research Agent's web findings
2. **Compilation check**: After SDE3 writes code, TL verifies it compiles (`tsc --noEmit` / `npm run build`)
3. **Test execution**: Tester actually runs tests (not just writes them)
4. **Multi-agent review**: 4 independent reviewers catch different issues
5. **Auditor cross-reference**: Final check against original requirements
6. **Maker-checker on everything**: No agent self-validates

---

## Database Tables (new)

```sql
-- Track projects/tasks
CREATE TABLE agent_projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL, -- 'project' | 'task'
  description   TEXT NOT NULL,
  status        TEXT NOT NULL, -- workflow phase
  workspace_path TEXT,
  github_repo   TEXT,
  github_pr_url TEXT,
  cost_estimate REAL,
  actual_cost   REAL DEFAULT 0,
  created_at    TEXT NOT NULL,
  completed_at  TEXT,
  error         TEXT
);

-- Message bus history
CREATE TABLE agent_messages (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES agent_projects(id),
  from_role       TEXT NOT NULL,
  from_instance   TEXT,
  to_role         TEXT NOT NULL,
  to_instance     TEXT,
  type            TEXT NOT NULL,
  phase           TEXT NOT NULL,
  content         TEXT NOT NULL,
  files_changed   TEXT, -- JSON array of file paths
  created_at      TEXT NOT NULL
);

-- Per-project file tracking
CREATE TABLE agent_files (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES agent_projects(id),
  file_path   TEXT NOT NULL,
  created_by  TEXT NOT NULL, -- agent role + instance
  modified_by TEXT,
  content     TEXT NOT NULL,
  version     INTEGER DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

---

## Implementation Order

### Phase 1: Foundation (this session)
- [ ] Agent types + interfaces
- [ ] Message bus
- [ ] Base agent class
- [ ] Workspace manager
- [ ] Cost estimator
- [ ] Orchestrator state machine
- [ ] DB migrations for new tables

### Phase 2: Agents (next session)
- [ ] Research Agent
- [ ] PM Agent
- [ ] EM Agent
- [ ] TL Agent
- [ ] SDE3 Agent
- [ ] Reviewer Agent (4 specialisations)
- [ ] Tester Agent
- [ ] Auditor Agent

### Phase 3: GitHub + Integration
- [ ] GitHub client (octokit)
- [ ] GitHub Agent
- [ ] Telegram commands + skill registration
- [ ] Progress reporting
- [ ] End-to-end testing

### Phase 4: Polish
- [ ] Budget tracking
- [ ] Error recovery / retry logic
- [ ] Admin dashboard pages for agent workflows
- [ ] Cron job integration for scheduled tasks
