// @octo/loop — 领域类型定义（对齐 Loop 契约，含 space_id/workspace_id 口子）
// 命名一律使用 Loop 语义；不暴露外部品牌。

/* ---------- 通用 ---------- */

export type AssigneeType = "member" | "agent" | "squad";

export interface AssigneeCandidate {
  id: string;
  type: AssigneeType;
  name: string;
  avatar_color?: string;
}

export interface ListParams {
  workspace_id?: string;
  keyword?: string;
}

/* ---------- Issue 域 ---------- */

export type IssueStatus =
  | "backlog"
  | "todo"
  | "in_progress"
  | "in_review"
  | "done"
  | "blocked"
  | "cancelled";

export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export interface IssueComment {
  id: string;
  issue_id: string;
  parent_id: string | null;
  author_type: AssigneeType;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export interface Issue {
  id: string;
  workspace_id: string;
  number: number;
  identifier: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assignee_type: AssigneeType | null;
  assignee_id: string | null;
  assignee_name: string | null;
  creator_id: string;
  creator_name: string;
  project_id: string | null;
  project_name: string | null;
  position: number;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIssueReq {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee_type?: AssigneeType | null;
  assignee_id?: string | null;
  project_id?: string | null;
}

export interface UpdateIssueReq {
  title?: string;
  description?: string | null;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee_type?: AssigneeType | null;
  assignee_id?: string | null;
  project_id?: string | null;
  position?: number;
}

/* ---------- Skill 域 ---------- */

export type SkillSource = "github" | "local" | "workspace";

export interface Skill {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  source: SkillSource;
  content: string;
  used_by: number;
  creator_name: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertSkillReq {
  name: string;
  description?: string;
  source?: SkillSource;
  content?: string;
}

/* ---------- Project 域 ---------- */

export type ProjectStatus =
  | "planned"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export interface Project {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  icon: string | null;
  status: ProjectStatus;
  priority: IssuePriority;
  lead_type: AssigneeType | null;
  lead_id: string | null;
  lead_name: string | null;
  issue_count: number;
  done_count: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertProjectReq {
  title: string;
  description?: string | null;
  icon?: string | null;
  status?: ProjectStatus;
  priority?: IssuePriority;
  lead_type?: AssigneeType | null;
  lead_id?: string | null;
}

/* ---------- Agent 域 ---------- */

export type AgentStatus = "idle" | "working" | "offline" | "error";
export type AgentVisibility = "workspace" | "private";

export interface Agent {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  status: AgentStatus;
  runtime_id: string;
  runtime_name: string;
  model: string;
  visibility: AgentVisibility;
  max_concurrent_tasks: number;
  owner_name: string;
  skills: string[];
  runs_30d: number;
  created_at: string;
  updated_at: string;
}

export interface UpsertAgentReq {
  name: string;
  description?: string;
  instructions?: string;
  status?: AgentStatus;
  runtime_id?: string;
  model?: string;
  visibility?: AgentVisibility;
  max_concurrent_tasks?: number;
}

/* ---------- Squad 域 ---------- */

export interface SquadMember {
  member_type: AssigneeType;
  member_id: string;
  member_name: string;
  role: string;
}

export interface Squad {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  leader_id: string;
  leader_name: string;
  creator_name: string;
  members: SquadMember[];
  created_at: string;
  updated_at: string;
}

export interface UpsertSquadReq {
  name: string;
  description?: string;
  instructions?: string;
  leader_id?: string;
}

/* ---------- space_id → workspace_id ---------- */

const DEFAULT_WORKSPACE_ID = "ws-loop-demo";

/**
 * space_id → workspace_id 解析入口。
 * 基础版本直接透传；后续接真实链路时在此把 space_id 映射为 workspace_id，
 * Loop 内部接口调用统一携带 workspace_id。
 */
export function resolveWorkspaceId(spaceId?: string): string {
  return spaceId && spaceId.trim() ? spaceId : DEFAULT_WORKSPACE_ID;
}
