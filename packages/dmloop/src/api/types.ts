// @octo/loop — 领域类型（对齐真实 fleet 契约）。
// 命名一律使用 Loop 语义，不暴露上游品牌。
// 说明：fleet 列表接口不返回展示用名字（assignee_name / project_name 等），
// 这些由 directory.ts 解析后作为可选字段回填，页面直接读取。

export type AssigneeType = "member" | "agent" | "squad";

export interface AssigneeCandidate {
  id: string;
  type: AssigneeType;
  name: string;
  avatar_color?: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  issue_prefix?: string;
  avatar_url?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  name: string;
  email?: string;
  avatar_url?: string | null;
  // octo IM uid this multica user is bridged to, or null for native members.
  // The UI renders member identity (name/avatar) from octo by this uid.
  octo_uid?: string | null;
}

export interface Invitation {
  id: string;
  workspace_id: string;
  inviter_id?: string;
  invitee_email: string;
  invitee_user_id?: string | null;
  role: string;
  created_at?: string;
}

export interface ListParams {
  workspace_id?: string;
  keyword?: string;
}

/* ---------- Issue ---------- */
export type IssueStatus =
  | "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

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
  creator_type?: AssigneeType;
  creator_id: string;
  parent_issue_id?: string | null;
  project_id: string | null;
  position: number;
  stage?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  created_at: string;
  updated_at: string;
  // 由 directory 回填（展示用）
  assignee_name?: string | null;
  project_name?: string | null;
  creator_name?: string | null;
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

export interface IssueComment {
  id: string;
  issue_id: string;
  parent_id?: string | null;
  author_type: AssigneeType;
  author_id: string;
  content: string;
  created_at: string;
  author_name?: string | null;
}

export type TaskStatus =
  | "queued" | "dispatched" | "running" | "completed" | "failed" | "cancelled" | string;

export interface AgentTask {
  id: string;
  issue_id: string;
  agent_id?: string | null;
  status: TaskStatus;
  trigger_summary?: string;
  created_at: string;
  completed_at?: string | null;
  agent_name?: string | null;
}

/** 执行记录（run）：GET /issues/:id/task-runs。 */
export interface TaskRun {
  id: string;
  issue_id: string;
  agent_id?: string | null;
  runtime_id?: string | null;
  status: TaskStatus;
  priority?: number;
  trigger_summary?: string;
  dispatched_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  result?: { output?: string } & Record<string, unknown>;
  failure_reason?: string;
  // 回填
  agent_name?: string | null;
}

/** 执行消息（run-messages）：GET /tasks/:id/messages。 */
export interface RunMessage {
  task_id: string;
  issue_id?: string;
  seq: number;
  type: string;
  tool?: string;
  input?: unknown;
  text?: string;
  content?: unknown;
  created_at: string;
}

/* ---------- Skill ---------- */
export interface SkillOrigin {
  type?: string;
  owner?: string;
  repo?: string;
  skill?: string;
  source_url?: string;
}
export interface Skill {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  config?: { origin?: SkillOrigin } & Record<string, unknown>;
  content?: string;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}
export interface UpsertSkillReq {
  name: string;
  description?: string;
  content?: string;
}

/** 从运行时拷贝技能：runtime 上发现的本地技能条目。 */
export interface RuntimeLocalSkillSummary {
  key: string;
  name: string;
  description?: string;
  source_path?: string;
  provider?: string;
  file_count?: number;
}
export interface RuntimeLocalSkillListRequest {
  id: string;
  runtime_id: string;
  status: string; // pending | completed | failed | ...
  skills?: RuntimeLocalSkillSummary[];
  supported: boolean;
  error?: string;
}
export interface RuntimeLocalSkillImportRequest {
  id: string;
  runtime_id: string;
  skill_key: string;
  status: string;
  skill?: Skill;
  error?: string;
}

/* ---------- Project ---------- */
export type ProjectStatus = "planned" | "in_progress" | "paused" | "completed" | "cancelled";
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
  issue_count: number;
  done_count: number;
  resource_count?: number;
  created_at: string;
  updated_at: string;
  lead_name?: string | null;
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

/* ---------- Agent ---------- */
export type AgentStatus = "idle" | "working" | "offline" | "error" | string;
export type AgentVisibility = "workspace" | "private";
export interface Agent {
  id: string;
  workspace_id: string;
  runtime_id: string;
  name: string;
  description: string;
  instructions: string;
  avatar_url?: string | null;
  status: AgentStatus;
  model: string;
  thinking_level?: string;
  visibility: AgentVisibility;
  max_concurrent_tasks: number;
  custom_args?: string[];
  has_custom_env?: boolean;
  owner_id?: string | null;
  skills?: Array<{ id: string; name: string; description?: string }>;
  created_at: string;
  updated_at: string;
  // 回填
  runtime_name?: string | null;
  owner_name?: string | null;
}
export interface CreateAgentReq {
  name: string;
  description?: string;
  instructions?: string;
  runtime_id: string;
  model?: string;
  visibility?: AgentVisibility;
  max_concurrent_tasks?: number;
}
export interface UpdateAgentReq {
  name?: string;
  description?: string;
  instructions?: string;
  status?: AgentStatus;
  model?: string;
  thinking_level?: string;
  visibility?: AgentVisibility;
  max_concurrent_tasks?: number;
  custom_args?: string[];
}

/* ---------- Squad ---------- */
export interface SquadMember {
  member_type: AssigneeType;
  member_id: string;
  role: string;
  member_name?: string | null;
}
export interface Squad {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  instructions: string;
  avatar_url?: string | null;
  leader_id: string;
  creator_id: string;
  member_count?: number;
  member_preview?: SquadMember[];
  members?: SquadMember[];
  created_at: string;
  updated_at: string;
  leader_name?: string | null;
  creator_name?: string | null;
}
export interface UpsertSquadReq {
  name: string;
  description?: string;
  instructions?: string;
  leader_id?: string;
}

/* ---------- Runtime ---------- */
export type RuntimeMode = "local" | "cloud";
export type RuntimeStatus = "online" | "offline";
export interface RuntimeDevice {
  id: string;
  workspace_id: string;
  daemon_id?: string | null;
  name: string;
  runtime_mode: RuntimeMode;
  provider: string;
  launch_header?: string;
  status: RuntimeStatus;
  device_info: string;
  metadata?: Record<string, unknown>;
  owner_id?: string | null;
  visibility: string;
  profile_id?: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}
