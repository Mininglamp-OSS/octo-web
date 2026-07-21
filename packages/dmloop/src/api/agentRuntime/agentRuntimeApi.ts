// @octo/loop — Agent Runtime API（会话运行期）
//
// 与既有 agentApi.ts（agent 实体 CRUD）相互独立：本模块面向「一次会话里跑 turn」的
// 运行期操作——发起 prompt（流式）、列会话、取会话历史、中断当前 turn，以及
// 差异 / 检查点 / 回滚（均标注「待后端确认」）。
//
// 路径基于研发设计文档的前端预期；带 SSE 的 prompt 走 sseClient，其余走 httpClient。
// ⚠️ diff / checkpoint / rollback 端点与字段后端未定，仅按前端契约预留，联调再对齐。

import { httpClient } from "./httpClient";
import { connectSse, type SseConnection, type SseFrame } from "./sseClient";
import type {
  AgentEvent,
  AgentSessionSummary,
  SessionEntry,
  SessionState,
  FileDiff,
  Checkpoint,
} from "./contracts";

/* ============================ 会话读取 ============================ */

// 列出会话（GET /agent/sessions）。用于会话列表 UI。
export async function listSessions(params?: {
  agentId?: string;
  limit?: number;
}): Promise<AgentSessionSummary[]> {
  const rows = await httpClient.get<AgentSessionSummary[]>("/agent/sessions", {
    agent_id: params?.agentId,
    limit: params?.limit,
  });
  return rows ?? [];
}

// 取单个会话元信息（GET /agent/sessions/:key）。
export function getSession(sessionKey: string): Promise<AgentSessionSummary> {
  return httpClient.get<AgentSessionSummary>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}`,
  );
}

// 重建历史（GET /agent/sessions/:key/entries）：切会话时用它拉全量已归约条目。
export async function getEntries(
  sessionKey: string,
  params?: { since_seq?: number; limit?: number },
): Promise<SessionEntry[]> {
  const rows = await httpClient.get<SessionEntry[]>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/entries`,
    { since_seq: params?.since_seq, limit: params?.limit },
  );
  return rows ?? [];
}

// 取会话运行态（GET /agent/sessions/:key/state）：
// SSE 回放不可用时，用它 + getEntries 对账兜底、判断是否可能丢帧。
export function getState(sessionKey: string): Promise<SessionState> {
  return httpClient.get<SessionState>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/state`,
  );
}

/* ============================ prompt（流式跑 turn） ============================ */

export interface PromptOptions {
  sessionKey?: string;
  agentId?: string;
  prompt: string;
  // 续推游标（重连或恢复时带上）。
  lastEventId?: string;
  // 解析后的领域事件回调。
  onEvent: (event: AgentEvent) => void;
  onOpen?: (info: { reconnect: boolean; attempt: number }) => void;
  onError?: (err: unknown, willRetry: boolean) => void;
  onClose?: () => void;
}

// 把 SSE 帧解析为领域事件：data 是 JSON；event 名对齐 type；无法解析时兜底 unknown。
export function frameToEvent(frame: SseFrame): AgentEvent | null {
  if (!frame.data && !frame.event) return null;
  let parsed: Record<string, unknown> = {};
  if (frame.data) {
    try {
      parsed = JSON.parse(frame.data) as Record<string, unknown>;
    } catch {
      // 非 JSON data：当作纯文本消息增量。
      parsed = { type: frame.event || "message_delta", text: frame.data };
    }
  }
  const type = (frame.event || (parsed.type as string) || "unknown") as AgentEvent["type"];
  const seqRaw = parsed.seq;
  return {
    type,
    seq: typeof seqRaw === "number" ? seqRaw : undefined,
    id: frame.id ?? (parsed.id as string | undefined),
    messageId: parsed.message_id as string | undefined,
    role: parsed.role as AgentEvent["role"],
    text: parsed.text as string | undefined,
    toolCallId: parsed.tool_call_id as string | undefined,
    toolName: parsed.tool_name as string | undefined,
    input: parsed.input,
    output: parsed.output,
    phase: parsed.phase as AgentEvent["phase"],
    errorMessage: parsed.error as string | undefined,
    raw: parsed,
  };
}

// 发起一次流式 prompt。返回 SseConnection（含 close 中断、done、lastEventId）。
export function prompt(opts: PromptOptions): SseConnection {
  const { onEvent, prompt: text, sessionKey, agentId, lastEventId, ...cbs } = opts;
  return connectSse("/agent/prompt", {
    method: "POST",
    body: { prompt: text, session_key: sessionKey, agent_id: agentId },
    lastEventId,
    onFrame: (frame) => {
      const ev = frameToEvent(frame);
      if (ev) onEvent(ev);
    },
    onOpen: cbs.onOpen,
    onError: cbs.onError,
    onClose: cbs.onClose,
  });
}

/* ============================ 中断当前 turn ============================ */

// 中断正在运行的 turn（POST /agent/sessions/:key/abort）。
export function abort(sessionKey: string): Promise<void> {
  return httpClient.post<void>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/abort`,
    {},
  );
}

/* ============================ 富 diff（待后端确认） ============================ */
// ⚠️ 以下端点 / 字段后端尚未确认，仅按前端 diff JSON 契约预留。联调后以后端为准。

// 取一次会话（或某检查点）的文件差异集合。
export async function getDiff(params: {
  sessionKey: string;
  // 待后端确认：是否支持按检查点 / turn 过滤。
  checkpointId?: string;
  path?: string;
}): Promise<FileDiff[]> {
  const rows = await httpClient.get<FileDiff[]>(
    `/agent/sessions/${encodeURIComponent(params.sessionKey)}/diff`,
    { checkpoint_id: params.checkpointId, path: params.path },
  );
  return rows ?? [];
}

/* ============================ 检查点 / 回滚（待后端确认） ============================ */

export async function listCheckpoints(sessionKey: string): Promise<Checkpoint[]> {
  const rows = await httpClient.get<Checkpoint[]>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/checkpoints`,
  );
  return rows ?? [];
}

// 回滚到某检查点。待后端确认：是否幂等、回滚粒度（工作区 / 会话）。
export function rollback(sessionKey: string, checkpointId: string): Promise<void> {
  return httpClient.post<void>(
    `/agent/sessions/${encodeURIComponent(sessionKey)}/rollback`,
    { checkpoint_id: checkpointId },
  );
}
