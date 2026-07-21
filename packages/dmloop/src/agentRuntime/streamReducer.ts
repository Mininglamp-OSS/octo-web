// @octo/loop — Agent 事件流归约器（纯函数）
//
// 把后端 SSE 事件序列归约成 UI 直接可渲染的 {messages, toolCalls, thinking, phase}。
// 抽成纯函数（不依赖 React）以便单测覆盖三大边界：
//   - 乱序：事件按 seq 排序落位，后到的低 seq 也能插对位置
//   - 重连：同一事件（seq / id）重复到达时幂等去重，不产生重复消息/工具行
//   - 中断：abort 后进入 aborted 相位，后续迟到帧不再改写终态
//
// useAgentStream 只是把它接到 SSE + React state 上。

import type { AgentEvent, AgentPhase } from "../api/agentRuntime/contracts";

export interface StreamMessage {
  id: string; // messageId 或合成 id
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  seq: number; // 首个增量的 seq，用于排序
}

export interface StreamToolCall {
  id: string; // toolCallId
  name?: string;
  input?: unknown;
  output?: unknown;
  status: "running" | "done" | "error";
  seq: number;
}

export interface ThinkingEntry {
  id: string;
  text: string;
  seq: number;
}

export interface AgentStreamState {
  messages: StreamMessage[];
  toolCalls: StreamToolCall[];
  thinking: ThinkingEntry[];
  phase: AgentPhase;
  // 已处理过的事件 key（seq 优先，否则 id），用于重连去重。
  seen: Set<string>;
  // 已知最大 seq，用于对账丢帧判断。
  maxSeq: number;
  // 是否可能丢帧（回放不可用降级对账时置位，UI 展示「可能有事件缺失」）。
  maybeMissingEvents: boolean;
  // 终态锁：中断 / 结束后置位，迟到帧不再改写相位。
  finalized: boolean;
  errorMessage?: string;
}

export function initialStreamState(): AgentStreamState {
  return {
    messages: [],
    toolCalls: [],
    thinking: [],
    phase: "idle",
    seen: new Set(),
    maxSeq: -1,
    maybeMissingEvents: false,
    finalized: false,
  };
}

// 事件去重 key：优先 seq（后端单调递增、最可靠），否则用 id，都没有则不可去重（返回 null）。
function eventKey(ev: AgentEvent): string | null {
  if (typeof ev.seq === "number") return `seq:${ev.seq}`;
  if (ev.id) return `id:${ev.id}`;
  return null;
}

// 按 seq 升序插入（乱序保护）：无 seq 的追加到末尾。
function insertBySeq<T extends { seq: number }>(list: T[], item: T): T[] {
  if (item.seq < 0) return [...list, item];
  const next = [...list];
  let i = next.length;
  while (i > 0 && next[i - 1].seq > item.seq) i -= 1;
  next.splice(i, 0, item);
  return next;
}

// 归约单个事件，返回新状态（不可变）。
export function reduceEvent(state: AgentStreamState, ev: AgentEvent): AgentStreamState {
  // 1) 去重：重连回放时相同事件会再次到达。
  const key = eventKey(ev);
  if (key && state.seen.has(key)) return state;

  // 2) 终态锁：aborted/done 之后到达的内容帧不再改写消息（迟到的 tool_result 可仍记录，
  //    但不解除终态）。这里对 message/thinking/phase 一律忽略，保持终态稳定。
  const seq = typeof ev.seq === "number" ? ev.seq : -1;
  const seen = key ? new Set(state.seen).add(key) : state.seen;
  const maxSeq = seq > state.maxSeq ? seq : state.maxSeq;

  const base: AgentStreamState = { ...state, seen, maxSeq };

  switch (ev.type) {
    case "message":
    case "message_delta": {
      if (state.finalized && ev.type === "message_delta") return base;
      const mid = ev.messageId || (ev.id ? `msg:${ev.id}` : `msg:seq:${seq}`);
      const role = ev.role || "assistant";
      const existing = base.messages.find((m) => m.id === mid);
      let messages: StreamMessage[];
      if (existing) {
        // 同一条消息的增量：message_delta 追加，message（整段）覆盖。
        const nextText = ev.type === "message" ? ev.text ?? "" : existing.text + (ev.text ?? "");
        messages = base.messages.map((m) =>
          m.id === mid ? { ...m, text: nextText, role } : m,
        );
      } else {
        messages = insertBySeq(base.messages, {
          id: mid,
          role,
          text: ev.text ?? "",
          seq,
        });
      }
      return {
        ...base,
        messages,
        phase: base.finalized ? base.phase : "acting",
      };
    }

    case "thinking": {
      const tid = ev.messageId || (ev.id ? `think:${ev.id}` : `think:seq:${seq}`);
      const existing = base.thinking.find((t) => t.id === tid);
      let thinking: ThinkingEntry[];
      if (existing) {
        thinking = base.thinking.map((t) =>
          t.id === tid ? { ...t, text: t.text + (ev.text ?? "") } : t,
        );
      } else {
        thinking = insertBySeq(base.thinking, { id: tid, text: ev.text ?? "", seq });
      }
      return { ...base, thinking, phase: base.finalized ? base.phase : "thinking" };
    }

    case "tool_call": {
      const cid = ev.toolCallId || (ev.id ? `tool:${ev.id}` : `tool:seq:${seq}`);
      const existing = base.toolCalls.find((t) => t.id === cid);
      let toolCalls: StreamToolCall[];
      if (existing) {
        toolCalls = base.toolCalls.map((t) =>
          t.id === cid ? { ...t, name: ev.toolName ?? t.name, input: ev.input ?? t.input } : t,
        );
      } else {
        toolCalls = insertBySeq(base.toolCalls, {
          id: cid,
          name: ev.toolName,
          input: ev.input,
          status: "running",
          seq,
        });
      }
      return { ...base, toolCalls, phase: base.finalized ? base.phase : "acting" };
    }

    case "tool_result": {
      const cid = ev.toolCallId || (ev.id ? `tool:${ev.id}` : `tool:seq:${seq}`);
      const existing = base.toolCalls.find((t) => t.id === cid);
      let toolCalls: StreamToolCall[];
      if (existing) {
        toolCalls = base.toolCalls.map((t) =>
          t.id === cid ? { ...t, output: ev.output, status: "done" } : t,
        );
      } else {
        // 结果先于调用到达（乱序）：先建占位行，调用帧到达时补 input/name。
        toolCalls = insertBySeq(base.toolCalls, {
          id: cid,
          name: ev.toolName,
          output: ev.output,
          status: "done",
          seq,
        });
      }
      return { ...base, toolCalls };
    }

    case "phase": {
      if (base.finalized) return base;
      return { ...base, phase: ev.phase ?? base.phase };
    }

    case "error": {
      return {
        ...base,
        phase: "error",
        finalized: true,
        errorMessage: ev.errorMessage || "Agent run failed",
      };
    }

    case "done": {
      return { ...base, phase: base.phase === "error" ? "error" : "done", finalized: true };
    }

    default:
      return base; // unknown：已计入 seen/maxSeq，内容不改（full 档由原始事件流单独展示）
  }
}

// 批量归约（重放历史条目 / 初始化）。
export function reduceAll(events: AgentEvent[], from = initialStreamState()): AgentStreamState {
  return events.reduce(reduceEvent, from);
}

// 主动中断：标记 aborted 终态（迟到帧不再改写）。
export function markAborted(state: AgentStreamState): AgentStreamState {
  return { ...state, phase: "aborted", finalized: true };
}

// 断线对账：拿服务端 last_seq 与本地 maxSeq 比对，缺口则置「可能丢帧」。
export function reconcileMissing(state: AgentStreamState, serverLastSeq?: number): AgentStreamState {
  if (typeof serverLastSeq !== "number") return state;
  const missing = serverLastSeq > state.maxSeq;
  return missing ? { ...state, maybeMissingEvents: true } : state;
}
