// @octo/loop — 领域类型（对齐后端契约）。
// 命名一律使用 Loop 语义，不暴露上游品牌。
// 说明：后端列表接口不返回展示用名字（assignee_name / project_name 等），
// 这些由 directory.ts 解析后作为可选字段回填，页面直接读取。

export type AssigneeType = "member" | "agent" | "squad";

export interface AssigneeCandidate {
  id: string;
  type: AssigneeType;
  name: string;
  avatar_color?: string;
  // octo IM uid for member-type candidates (null for native members / agents /
  // squads), used to render the octo avatar via WKApp.shared.avatarUser.
  octo_uid?: string | null;
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
  // octo IM uid this backend user is bridged to, or null for native members.
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

// 时间范围筛选可选字段(后端仅接受这两列)。
export const ISSUE_DATE_FIELDS = ["created_at", "updated_at"] as const;
export type IssueDateField = (typeof ISSUE_DATE_FIELDS)[number];

export interface ListParams {
  workspace_id?: string;
  // 客户端关键词过滤:projectApi/skillApi/squadApi/agentApi/runtimeApi 共用此字段。
  // issue 列表不再用它(关键词走 searchIssues → /issues/search),但其它 list 端点仍需,勿删。
  keyword?: string;
  // 统一多选筛选(后端数组参,与看板/列表/分组共用)。空数组 = 不发。issue 列表只用这套数组,
  // 不再有同维单值(已移除,避免单/复数同发的歧义)。
  statuses?: IssueStatus[];
  priorities?: IssuePriority[];
  assignee_ids?: string[];
  assignee_types?: AssigneeType[];
  include_no_assignee?: boolean;
  creator_ids?: string[];
  project_ids?: string[];
  include_no_project?: boolean;
  label_ids?: string[];
  // 时间范围筛选:date_field(仅 created_at|updated_at)+ date_start + date_end 必须同时给,
  // 值为 RFC3339;后端要求 start 严格早于 end。
  date_field?: IssueDateField;
  date_start?: string;
  date_end?: string;
  limit?: number;
  offset?: number;
}

/* ---------- 按负责人分组板 (GET /issues/grouped) ---------- */
// 后端仅支持 group_by=assignee。scope pill 通过 assignee_types / involves_user_id 收窄范围。
// "involves" 需后端 user UUID(非 octo uid):由候选里 octo_uid===loginInfo.uid 的成员解析。
export type IssueScope = "all" | "members" | "agents" | "involves";

export interface GroupedParams {
  statuses?: IssueStatus[];
  priorities?: IssuePriority[];
  assignee_types?: AssigneeType[];
  assignee_id?: string;
  assignee_ids?: string[];
  include_no_assignee?: boolean;
  involves_user_id?: string;
  creator_id?: string;
  creator_ids?: string[];
  project_id?: string;
  project_ids?: string[];
  // 纳入无项目的 issue(后端 include_no_project)。与项目多选配对 = 所选项目 ∪ 无项目。
  include_no_project?: boolean;
  label_ids?: string[];
  date_field?: IssueDateField;
  date_start?: string;
  date_end?: string;
  limit?: number;
}

// 一个负责人分组;assignee_type/assignee_id 为 null 表示「未指派」组。
export interface IssueGroup {
  id: string;
  assignee_type: AssigneeType | null;
  assignee_id: string | null;
  issues: Issue[];
  total: number;
  // 由 directory 回填(展示用):分组头显示的负责人名。
  assignee_name?: string | null;
  assignee_avatar?: string | null;
}

// 工作区级运行中任务快照的最小消费形状 (GET /agent-task-snapshot 裸数组)。
// 只取 issue_id + status,用于算「哪些 issue 有 agent 正在跑」的集合。
export interface AgentTaskSnapshotItem {
  issue_id: string; // 空串表示无关联 issue(聊天/autopilot 触发)
  status: TaskStatus;
}

/* ---------- Issue ---------- */
export type IssueStatus =
  | "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

/** issue 标签(后端 list/detail 端点批量回填 issue.labels)。color 为 hex。 */
export interface IssueLabel {
  id: string;
  name: string;
  color: string;
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
  // octo 头像 URL（member 型 actor，由 directory 回填；agent/squad/原生成员为空）
  assignee_avatar?: string | null;
  creator_avatar?: string | null;
  // 后端 list/detail 端点批量回填；其它端点(update/ws)不带 → 保持已有。
  labels?: IssueLabel[] | null;
  // issue 级 emoji 反应:仅详情端点(GetIssue)回填;list/update/ws 不带 → 保持已有。
  reactions?: IssueReaction[] | null;
  // issue 附件:仅详情端点(GetIssue)回填;list/update/ws 不带 → 保持已有。
  attachments?: Attachment[] | null;
  // 搜索结果专属(GET /issues/search):命中来源 + 高亮片段。列表/详情端点不返回。
  match_source?: string;
  matched_snippet?: string | null;
  matched_description_snippet?: string | null;
  matched_comment_snippet?: string | null;
}

export interface CreateIssueReq {
  title: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee_type?: AssigneeType | null;
  assignee_id?: string | null;
  project_id?: string | null;
  // 新建子 issue 时绑定父任务(后端 CreateIssueRequest.parent_issue_id)。
  parent_issue_id?: string | null;
  // 新建时绑定已上传附件(上传返回的 id 列表)。
  attachment_ids?: string[];
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
  // 后端按 rawFields 存在性判断：省略=不动；传值=设置；传 ""/null=清除。
  // start_date/due_date 为日历日 "YYYY-MM-DD"(后端 ParseCalendarDate)。
  // parent_issue_id 设置时后端做环检测(不能设自己或后代为父)。stage 需 >= 1。
  start_date?: string | null;
  due_date?: string | null;
  parent_issue_id?: string | null;
  stage?: number | null;
  // 绑定新上传的附件(id 列表);后端幂等,重复 id 无副作用。
  attachment_ids?: string[];
  // 指派/状态变更触发 agent run 时：suppress_run=true 表示“暂不开始”；handoff_note 仅在真起 run 时消费。
  suppress_run?: boolean;
  handoff_note?: string;
}

/* ---------- 派单预触发（RunConfirm 预确认，只读） ---------- */
export interface IssueTriggerPreviewParams {
  issue_ids?: string[];
  is_create?: boolean;
  assignee_type?: AssigneeType | null;
  assignee_id?: string | null;
  status?: IssueStatus;
}
export interface IssueTriggerPreviewItem {
  issue_id: string;
  agent_id: string; // 将运行的 agent（squad 则为 leader）
  source: string; // "assign" | "status"
  handoff_supported: boolean; // 目标 runtime CLI 版本是否支持渲染 handoff note
}
export interface IssueTriggerPreview {
  triggers: IssueTriggerPreviewItem[];
  total_count: number;
}

/** 评论派单预览:这条评论会唤醒的 agent(POST /issues/:id/comments/trigger-preview)。
 *  后端还返回 avatar_url/source/reason,前端暂只用 id+name,按需再加。 */
export interface CommentTriggerAgent {
  id: string;
  name: string;
}

/** 评论 emoji 反应(后端 /comments/:id/reactions;list/timeline 端点按 comment 分组回填)。 */
export interface CommentReaction {
  id: string;
  comment_id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
  created_at: string;
}

/** issue 级 emoji 反应(GET issue 详情回填 issue.reactions;POST/DELETE /issues/:id/reactions)。 */
export interface IssueReaction {
  id: string;
  issue_id: string;
  actor_type: string;
  actor_id: string;
  emoji: string;
  created_at: string;
}

/** issue 订阅者(GET /issues/:id/subscribers)。reason: manual|creator|assignee|mention|... */
export interface IssueSubscriber {
  issue_id: string;
  user_type: string;
  user_id: string;
  reason: string;
  created_at: string;
  /** octo IM uid the member is bridged to; null for agent/squad subscribers.
   *  Lets the web tell whether the current octo member is subscribed. */
  octo_uid?: string | null;
}

/** 附件(上传返回 + issue/comment 详情回填)。
 *  download_url 为短时签名 URL(仅即时展示、勿持久化);markdown_url 可持久化内联进 markdown 正文。 */
export interface Attachment {
  id: string;
  filename: string;
  url: string;
  download_url: string;
  markdown_url: string;
  content_type: string;
  size_bytes: number;
  created_at?: string;
  // 归属:issue 级附件 comment_id 为空;评论附件 comment_id 指向评论。
  // (后端 attachment 先绑 issue_id,再由 comment 的 attachment_ids 补 comment_id。)
  issue_id?: string | null;
  comment_id?: string | null;
}

/** issue 时间线条目(GET /issues/:id/timeline,不带分页参数时为裸数组、ASC)。
 *  合并 comment + activity 两类;活动流只用 activity 类(action/details)。 */
export interface TimelineEntry {
  type: "activity" | "comment";
  id: string;
  actor_type: string;
  actor_id: string;
  created_at: string;
  // activity 专属
  action?: string;
  details?: unknown;
  // comment 专属(活动流不用,列全为完整性)
  content?: string | null;
  // 由 directory 回填(展示用)
  actor_name?: string | null;
  actor_avatar?: string | null;
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
  author_avatar?: string | null;
  // 后端 list/timeline 端点按 comment 分组回填;其它端点不带 → 保持已有。
  reactions?: CommentReaction[] | null;
  // 已解决时间(resolve/unresolve);非空=该评论已标记为线程结论。后端一线程至多一条 resolved。
  resolved_at?: string | null;
  // 评论附件:后端 list/timeline 端点按 comment 分组回填;其它端点不带 → 保持已有。
  attachments?: Attachment[] | null;
}

export type TaskStatus =
  | "queued" | "dispatched" | "waiting_local_directory" | "running" | "completed" | "failed" | "cancelled" | string;

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

/** 执行消息（run-messages）：GET /tasks/:id/messages。对齐后端 TaskMessagePayload。 */
export interface RunMessage {
  task_id: string;
  issue_id?: string;
  seq: number;
  type: string; // thinking | text | tool_use | tool_result | error
  tool?: string; // tool_use/tool_result 的工具名
  content?: string; // 文本内容(text/thinking/error)
  input?: Record<string, unknown>; // tool_use 的入参
  output?: string; // tool_result 的输出
  created_at?: string;
}

/* ---------- Skill ---------- */
export interface SkillOrigin {
  type?: string;
  owner?: string;
  repo?: string;
  skill?: string;
  source_url?: string;
}
export interface SkillFile {
  id: string;
  skill_id: string;
  path: string;
  content: string;
  created_at: string;
  updated_at: string;
}
export interface Skill {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  config?: { origin?: SkillOrigin } & Record<string, unknown>;
  content?: string;
  files?: SkillFile[];
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}
export interface UpsertSkillReq {
  name: string;
  description?: string;
  content?: string;
  files?: { path: string; content: string }[];
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

/* ---------- Webhook（后端 /webhook-subscriptions，契约不变） ---------- */
export interface WebhookSubscription {
  id: string;
  workspace_id: string;
  project_id: string | null;
  url: string;
  events: string[];
  enabled: boolean;
  secret_hint: string;
  secret?: string; // 仅创建返回一次，需立即展示给用户保存
  created_at: string;
  updated_at: string;
}
export interface CreateWebhookReq {
  url: string;
  project_id?: string | null;
  events?: string[];
}
export interface UpdateWebhookReq {
  url?: string;
  events?: string[];
  enabled?: boolean;
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
  // 已配置的环境变量数量（后端只回数量不回值），供未展开时显示「N 个变量已配置」。
  custom_env_key_count?: number;
  // 连接器（MCP）配置：原始 JSON，交由运行时解析。三态：字段缺省=不变、null=清空、对象=覆盖。
  mcp_config?: unknown | null;
  // 调用方无权查看时后端会抹掉 mcp_config 并置此位。
  mcp_config_redacted?: boolean;
  owner_id?: string | null;
  skills?: Array<{ id: string; name: string; description?: string }>;
  created_at: string;
  updated_at: string;
  // 归档（软删除）标记：非空即已归档，可经 restore 恢复。
  archived_at?: string | null;
  archived_by?: string | null;
  // 回填
  runtime_name?: string | null;
  owner_name?: string | null;
  owner_avatar?: string | null;
}

/** Agent 任务（档案页的运行履历，读自既有 GET /agents/:id/tasks）。 */
export type AgentTaskStatus =
  | "queued"
  | "dispatched"
  | "waiting_local_directory"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type AgentTaskKind = "comment" | "autopilot" | "chat" | "quick_create" | "direct";
export interface AgentTask {
  id: string;
  agent_id: string;
  issue_id: string;
  status: AgentTaskStatus;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  kind?: AgentTaskKind;
  trigger_summary?: string;
  trigger_comment_id?: string;
  autopilot_run_id?: string;
  chat_session_id?: string;
}

/** Agent 贡献图数据点（GitHub 风格日历，读自 GET /agents/:id/contributions，稠密无缺口按天升序）。 */
export interface AgentContribution {
  date: string; // YYYY-MM-DD
  count: number;
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
  runtime_id?: string;
  model?: string;
  thinking_level?: string;
  visibility?: AgentVisibility;
  max_concurrent_tasks?: number;
  custom_args?: string[];
  mcp_config?: unknown | null;
}

/* ---------- Squad ---------- */
export interface SquadMember {
  member_type: AssigneeType;
  member_id: string;
  role: string;
  member_name?: string | null;
  member_avatar?: string | null;
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
  leader_avatar?: string | null;
}
export interface UpsertSquadReq {
  name: string;
  description?: string;
  instructions?: string;
  leader_id?: string;
}
/** 局部更新：名称/描述/指引/领队等均可单独提交（内联编辑、设为领队）。 */
export type UpdateSquadReq = Partial<UpsertSquadReq>;

/* Squad 成员实时状态（后端 deriveSquadMemberStatus 收敛的五态；人类成员 status=null）。 */
export type SquadMemberStatusValue = "working" | "idle" | "offline" | "unstable" | "archived";
export interface SquadActiveIssueBrief {
  issue_id: string;
  identifier: string;
  title: string;
  issue_status: string;
}
export interface SquadMemberStatus {
  member_type: AssigneeType;
  member_id: string;
  status: SquadMemberStatusValue | null;
  active_issues: SquadActiveIssueBrief[];
  last_active_at: string | null;
}
export interface SquadMemberStatusListResponse {
  members: SquadMemberStatus[];
}

/* ---------- Runtime ---------- */
export type RuntimeMode = "local" | "cloud";
export type RuntimeStatus = "online" | "offline";
export interface RuntimeDevice {
  id: string;
  workspace_id: string;
  daemon_id?: string | null;
  name: string;
  // custom_name: user-set machine display override. Shown as custom_name ?? name.
  // Optional for forward-compat: absent from backends without the column.
  custom_name?: string | null;
  runtime_mode: RuntimeMode;
  provider: string;
  launch_header?: string;
  status: RuntimeStatus;
  device_info: string;
  metadata?: Record<string, unknown>;
  owner_id?: string | null;
  visibility: string;
  // can_bind: whether the current member may bind an agent to this runtime as
  // owner (owner-only, matches backend canBindRuntimeAsOwner). Set on the
  // visibility-scoped /runtimes list. Optional for forward-compat: absent from
  // older backends, in which case the picker shows the runtime (no regression).
  can_bind?: boolean;
  profile_id?: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------- Autopilot（自动化，对接自动化后端契约） ---------- */
export type AutopilotStatus = "active" | "paused" | "archived";
export type AutopilotExecutionMode = "create_issue" | "run_only";
// "agent" → assignee_id 指向 agent；"squad" → 指向 squad，派发时解析到 leader。
export type AutopilotAssigneeType = "agent" | "squad";
export type AutopilotTriggerKind = "schedule" | "webhook" | "api";
// 后端驱动字符串——渲染未知值时走通用兜底，勿用穷尽 switch。
export type AutopilotRunStatus =
  | "issue_created"
  | "running"
  | "completed"
  | "failed"
  | "skipped";
export type AutopilotRunSource = "schedule" | "manual" | "webhook" | "api";

export interface Autopilot {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  project_id?: string | null;
  assignee_type: AutopilotAssigneeType;
  assignee_id: string;
  status: AutopilotStatus;
  execution_mode: AutopilotExecutionMode;
  issue_title_template: string | null;
  created_by_type: string;
  created_by_id: string;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
  // 仅列表端点返回的派生字段（detail/create/update 及旧服务端可能缺省）。
  trigger_kinds?: string[];
  next_run_at?: string | null;
  last_run_status?: string | null;
  // 前端 enrich 回填（后端列表不返回名字/头像）。
  assignee_name?: string | null;
  assignee_avatar?: string;
  project_name?: string | null;
}

export interface AutopilotTrigger {
  id: string;
  autopilot_id: string;
  kind: AutopilotTriggerKind;
  enabled: boolean;
  cron_expression: string | null;
  timezone: string | null;
  next_run_at: string | null;
  webhook_token?: string | null;
  webhook_path?: string | null;
  webhook_url?: string | null;
  label: string | null;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutopilotRun {
  id: string;
  autopilot_id: string;
  trigger_id: string | null;
  source: AutopilotRunSource;
  status: AutopilotRunStatus;
  issue_id: string | null;
  task_id: string | null;
  triggered_at: string;
  completed_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface CreateAutopilotRequest {
  title: string;
  description?: string;
  project_id?: string | null;
  assignee_type?: AutopilotAssigneeType;
  assignee_id: string;
  execution_mode: AutopilotExecutionMode;
  issue_title_template?: string;
}

export interface UpdateAutopilotRequest {
  title?: string;
  description?: string | null;
  project_id?: string | null;
  // 换 assignee 时须与 assignee_id 同时提交（服务端要求成对）。
  assignee_type?: AutopilotAssigneeType;
  assignee_id?: string;
  status?: AutopilotStatus;
  execution_mode?: AutopilotExecutionMode;
  issue_title_template?: string | null;
}

export interface CreateAutopilotTriggerRequest {
  kind: AutopilotTriggerKind;
  cron_expression?: string;
  timezone?: string;
  label?: string;
}

export interface UpdateAutopilotTriggerRequest {
  enabled?: boolean;
  cron_expression?: string;
  timezone?: string;
  label?: string;
}

export interface ListAutopilotsResponse {
  autopilots: Autopilot[];
  total: number;
}

export interface GetAutopilotResponse {
  autopilot: Autopilot;
  triggers: AutopilotTrigger[];
}

export interface ListAutopilotRunsResponse {
  runs: AutopilotRun[];
  total: number;
}
