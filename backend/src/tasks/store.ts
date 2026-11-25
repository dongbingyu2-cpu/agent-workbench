import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentKind, Part, PartPhase, PartStatus, Task, TaskStatus } from '../agents/types';
import type { Workspace } from './workspace';

export interface TaskStore {
  createTask(input: { title: string; description: string; workspacePath?: string }): Task;
  getTask(id: string): Task | undefined;
  listTasks(): Task[];
  updateTaskStatus(id: string, status: TaskStatus): void;
  updateTaskLeader(id: string, leaderAgentId: string | null): void;
  updateTaskDescription?(id: string, description: string): void;
  deleteTask(id: string): void;
  addPart(
    taskId: string,
    input: {
      title: string;
      description: string;
      assignedAgentId: string | null;
      agentKind?: AgentKind | null;
      phase?: PartPhase | null;
      status: PartStatus;
      model?: string | null;
      dependsOn?: string | null;
    },
  ): Part;
  getPart(id: string): Part | undefined;
  listParts(taskId: string): Part[];
  updatePart(id: string, patch: Partial<Pick<Part, 'status' | 'assignedAgentId'>>): void;
}

interface TaskRow {
  id: string;
  title: string;
  description: string;
  workspace_path: string;
  status: string;
  leader_agent_id: string | null;
}

interface PartRow {
  id: string;
  task_id: string;
  title: string;
  description: string;
  assigned_agent_id: string | null;
  status: string;
  result_path: string;
  done_marker: string;
  model: string | null;
  depends_on: string | null;
  agent_kind: string | null;
  phase: string | null;
}

function toPart(row: PartRow): Part {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    description: row.description,
    assignedAgentId: row.assigned_agent_id,
    agentKind: (row.agent_kind as AgentKind | null) ?? null,
    phase: (row.phase as PartPhase | null) ?? null,
    status: row.status as PartStatus,
    resultPath: row.result_path,
    doneMarker: row.done_marker,
    model: row.model ?? null,
    dependsOn: row.depends_on ?? null,
  };
}

export class SqliteTaskStore implements TaskStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly workspace: Workspace,
  ) {}

  private toTask(row: TaskRow): Task {
    this.workspace.registerTaskDir?.(row.id, row.workspace_path);
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      workspacePath: row.workspace_path,
      status: row.status as TaskStatus,
      parts: this.listParts(row.id),
      leaderAgentId: row.leader_agent_id ?? null,
    };
  }

  createTask(input: { title: string; description: string; workspacePath?: string }): Task {
    const title = input.title.trim();
    if (!title) throw new Error('task title is required');
    const id = randomUUID();
    const workspacePath = input.workspacePath && input.workspacePath.trim()
      ? this.workspace.ensureCustomDir(input.workspacePath.trim(), id)
      : this.workspace.ensureTaskDir(id);
    this.db
      .prepare('INSERT INTO tasks (id, title, description, workspace_path, status) VALUES (?, ?, ?, ?, ?)')
      .run(id, title, input.description, workspacePath, 'planned');
    return { id, title, description: input.description, workspacePath, status: 'planned', parts: [] };
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.toTask(row) : undefined;
  }

  listTasks(): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY rowid').all() as unknown as TaskRow[];
    return rows.map((row) => this.toTask(row));
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
  }

  updateTaskLeader(id: string, leaderAgentId: string | null): void {
    this.db.prepare('UPDATE tasks SET leader_agent_id = ? WHERE id = ?').run(leaderAgentId, id);
  }

  updateTaskDescription(id: string, description: string): void {
    this.db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(description, id);
  }

  deleteTask(id: string): void {
    this.db.prepare('DELETE FROM parts WHERE task_id = ?').run(id);
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  addPart(taskId: string, input: {
    title: string;
    description: string;
    assignedAgentId: string | null;
    agentKind?: AgentKind | null;
    phase?: PartPhase | null;
    status: PartStatus;
    model?: string | null;
    dependsOn?: string | null;
  }): Part {
    const id = randomUUID();
    this.workspace.ensureTaskDir(taskId);
    const resultPath = this.workspace.resultPath(taskId, id);
    const doneMarker = this.workspace.donePath(taskId, id);
    this.db
      .prepare(
        'INSERT INTO parts (id, task_id, title, description, assigned_agent_id, status, result_path, done_marker, model, depends_on, agent_kind, phase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        taskId,
        input.title,
        input.description,
        input.assignedAgentId,
        input.status,
        resultPath,
        doneMarker,
        input.model ?? null,
        input.dependsOn ?? null,
        input.agentKind ?? null,
        input.phase ?? null,
      );
    return {
      id,
      taskId,
      title: input.title,
      description: input.description,
      assignedAgentId: input.assignedAgentId,
      agentKind: input.agentKind ?? null,
      phase: input.phase ?? null,
      status: input.status,
      resultPath,
      doneMarker,
      model: input.model ?? null,
      dependsOn: input.dependsOn ?? null,
    };
  }

  getPart(id: string): Part | undefined {
    const row = this.db.prepare('SELECT * FROM parts WHERE id = ?').get(id) as PartRow | undefined;
    return row ? toPart(row) : undefined;
  }

  listParts(taskId: string): Part[] {
    const rows = this.db.prepare('SELECT * FROM parts WHERE task_id = ? ORDER BY rowid').all(taskId) as unknown as PartRow[];
    return rows.map(toPart);
  }

  updatePart(id: string, patch: Partial<Pick<Part, 'status' | 'assignedAgentId'>>): void {
    if (patch.status !== undefined) {
      this.db.prepare('UPDATE parts SET status = ? WHERE id = ?').run(patch.status, id);
    }
    if (patch.assignedAgentId !== undefined) {
      this.db.prepare('UPDATE parts SET assigned_agent_id = ? WHERE id = ?').run(patch.assignedAgentId, id);
    }
  }
}