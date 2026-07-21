// @octo/loop — Agent Runtime 契约类型
//
// 这是「Agent Runtime UI」新增能力的类型层，与既有 agentApi.ts（agent 实体 CRUD）
// 相互独立：本文件描述的是「一次会话（session）里 agent 跑 turn 时流式吐出的事件」
// 以及会话/差异/检查点等运行期数据结构。
//
// ⚠️ 契约边界：凡涉及 diff / checkpoint / rollback 的端点与字段均标注「待后端确认」，
// 下面这些接口是按研发设计文档（DESIGN-frontend-devdesign.md, APPROVED）的前端预期
// 建模，后端字段最终以联调为准；对不确定字段一律用可选属性 + 宽松解析，不脑补必填。

/* ============================ 通用响应封装 ============================ */

// 后端统一响应信封：{ ok, data, error }。httpClient 负责解包，业务层只拿到 data。
export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string } | string | null;
}

/* ============================ 事件流（SSE） ============================ */

// 一次 turn 内后端通过 SSE 推送的事件类型。名称与后端事件 `type` 字段对齐；
// 遇到未知类型时归约器保底当作 `unknown` 透传，不丢帧（利于 full 档排障）。
export type AgentEventType =
  | "message" // assistant 文本增量或整段
  | "message_delta" // assistant 文本增量（token 级）
  | "thinking" // reasoning / 思考过程（full 档展开）
  | "tool_call" // 工具调用发起（含入参）
  | "tool_result" // 工具调用返回（出参）
  | "phase" // 阶段变更（thinking/acting/waiting/done…）
  | "error" // turn 内错误
  | "done" // turn 结束
  | "unknown";

// 单个事件的标准形状。`seq` 与 `id` 用于排序 / 去重 / 断线续推：
// - seq：后端单调递增序号（用于本地乱序重排、去重）
// - id：SSE 帧 id（用作 Last-Event-ID 续推游标）
export interface AgentEvent {
  type: AgentEventType;
  seq?: number;
  id?: string;
  // 会话内消息归属：同一条 assistant 消息的多个增量共享 messageId。
  messageId?: string;
  role?: "user" | "assistant" | "system" | "tool";
  // 文本（message / message_delta / thinking）。
  text?: string;
  // 工具调用（tool_call / tool_result）。
  toolCallId?: string;
  toolName?: string;
  // 原始入参 / 出参：full 档原样展示，不做裁剪。
  input?: unknown;
  output?: unknown;
  // phase 事件的目标阶段。
  phase?: AgentPhase;
  // error 事件。
  errorMessage?: string;
  // 任意后端附加字段（full 档「完整事件流」原样保留）。
  raw?: Record<string, unknown>;
}

export type AgentPhase =
  | "idle"
  | "thinking"
  | "acting"
  | "waiting"
  | "done"
  | "aborted"
  | "error";

/* ============================ 会话（session） ============================ */

export interface AgentSessionSummary {
  session_key: string;
  title?: string;
  agent_id?: string;
  updated_at?: string;
  created_at?: string;
  // 该会话是否有 turn 正在运行（用于「abort 在跑 turn」按钮的可用态）。
  running?: boolean;
}

// getSession / get_entries 重建历史用的一条条目（已归约的消息/工具调用）。
export interface SessionEntry {
  seq?: number;
  id?: string;
  messageId?: string;
  role?: "user" | "assistant" | "system" | "tool";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  kind?: "message" | "thinking" | "tool_call" | "tool_result";
}

export interface SessionState {
  session_key: string;
  phase?: AgentPhase;
  running?: boolean;
  // 服务端已知的最大事件序号 / 最后一个事件 id：
  // 断线重连回放不可用时，用它与本地对账、判断是否可能丢帧。
  last_seq?: number;
  last_event_id?: string;
}

/* ============================ 富 diff（待后端确认） ============================ */

// diff JSON 契约（研发设计文档指定；后端字段待确认）。
// changeType 用后端常见枚举，解析时对未知值宽松兜底为 "modified"。
export type DiffChangeType =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied";

export interface DiffHunkLine {
  // 行类型：insert / delete / normal（上下文）。
  type: "insert" | "delete" | "normal";
  // 旧/新文件行号（normal 两者都有，insert 只有新，delete 只有旧）。
  oldLine?: number | null;
  newLine?: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
  header?: string;
  lines: DiffHunkLine[];
}

// 单文件 diff。binary / truncated 用于大文件与二进制的降级展示。
export interface FileDiff {
  path: string;
  oldPath?: string; // renamed 时的原路径
  changeType: DiffChangeType;
  hunks: DiffHunk[];
  binary?: boolean;
  truncated?: boolean;
  // 行数规模（用于「大文件切 Monaco」阈值判断，后端可选提供）。
  additions?: number;
  deletions?: number;
}

/* ============================ 检查点 / 回滚（待后端确认） ============================ */

export interface Checkpoint {
  id: string;
  session_key?: string;
  // 关联的 turn / 消息序号，用于时间线定位。
  seq?: number;
  label?: string;
  created_at?: string;
  // 该检查点相对上一个的文件改动摘要（可选）。
  files_changed?: number;
}
