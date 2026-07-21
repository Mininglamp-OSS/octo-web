// @octo/loop — useAgentStream
//
// 把 sseClient + streamReducer + 会话读取接口接到 React：
//   - send(prompt)：发起流式 turn，事件实时归约进 state
//   - abort()：中断当前 turn（本地立即置 aborted，并调后端 abort）
//   - loadHistory(sessionKey)：切会话时用 get_entries 重建历史
//   - SSE replay 续推：断线由 sseClient 自动带 Last-Event-ID 重连
//   - 回放不可用降级：SSE 重连彻底失败时，用 get_state + get_entries 对账兜底，
//     并把「可能有事件缺失」暴露给 UI

import { useCallback, useEffect, useRef, useState } from "react";
import type { SseConnection } from "../api/agentRuntime/sseClient";
import * as runtimeApi from "../api/agentRuntime/agentRuntimeApi";
import type { AgentEvent, SessionEntry } from "../api/agentRuntime/contracts";
import {
  AgentStreamState,
  initialStreamState,
  reduceEvent,
  reduceAll,
  markAborted,
  reconcileMissing,
} from "./streamReducer";

// 把 get_entries 的历史条目转成事件，喂给同一个归约器重建历史。
export function entriesToEvents(entries: SessionEntry[]): AgentEvent[] {
  return entries.map((e) => {
    const type: AgentEvent["type"] =
      e.kind === "tool_call"
        ? "tool_call"
        : e.kind === "tool_result"
          ? "tool_result"
          : e.kind === "thinking"
            ? "thinking"
            : "message";
    return {
      type,
      seq: e.seq,
      id: e.id,
      messageId: e.messageId,
      role: e.role,
      text: e.text,
      toolCallId: e.toolCallId,
      toolName: e.toolName,
      input: e.input,
      output: e.output,
    };
  });
}

export interface UseAgentStreamResult {
  state: AgentStreamState;
  running: boolean;
  error?: string;
  send: (prompt: string) => void;
  abort: () => void;
  loadHistory: (sessionKey: string) => Promise<void>;
  reset: () => void;
}

export function useAgentStream(opts: {
  sessionKey?: string;
  agentId?: string;
}): UseAgentStreamResult {
  const [state, setState] = useState<AgentStreamState>(initialStreamState);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const connRef = useRef<SseConnection | null>(null);
  // 用 ref 镜像最新 state，供 done 回调里对账（避免闭包读到陈旧 state）。
  const stateRef = useRef(state);
  stateRef.current = state;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connRef.current?.close();
    };
  }, []);

  const safeSet = useCallback((updater: (s: AgentStreamState) => AgentStreamState) => {
    if (!mountedRef.current) return;
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    setState(initialStreamState());
    setRunning(false);
    setError(undefined);
  }, []);

  // 回放不可用降级：用 get_state + get_entries 对账兜底。
  const reconcileFallback = useCallback(async (sessionKey: string) => {
    try {
      const [st, entries] = await Promise.all([
        runtimeApi.getState(sessionKey),
        runtimeApi.getEntries(sessionKey),
      ]);
      if (!mountedRef.current) return;
      // 用权威历史重建，再按 server last_seq 判断是否仍可能缺失。
      let rebuilt = reduceAll(entriesToEvents(entries));
      rebuilt = reconcileMissing(rebuilt, st.last_seq);
      // 保留本地已置位的「可能丢帧」标记。
      rebuilt = { ...rebuilt, maybeMissingEvents: rebuilt.maybeMissingEvents || stateRef.current.maybeMissingEvents };
      safeSet(() => rebuilt);
    } catch {
      // 兜底也失败：只置「可能丢帧」提示，不清空既有内容。
      safeSet((s) => ({ ...s, maybeMissingEvents: true }));
    }
  }, [safeSet]);

  const send = useCallback(
    (prompt: string) => {
      const sessionKey = opts.sessionKey;
      setError(undefined);
      setRunning(true);
      connRef.current?.close();

      const conn = runtimeApi.prompt({
        prompt,
        sessionKey,
        agentId: opts.agentId,
        // 断线续推由 sseClient 内部记录最近事件 id 后自动带 Last-Event-ID，
        // 这里首发不需要显式游标。
        onEvent: (ev: AgentEvent) => safeSet((s) => reduceEvent(s, ev)),
        onError: (_err, willRetry) => {
          if (!willRetry) {
            // 重连耗尽：标记可能丢帧，触发对账兜底。
            safeSet((s) => ({ ...s, maybeMissingEvents: true }));
          }
        },
        onClose: () => {
          if (!mountedRef.current) return;
          setRunning(false);
        },
      });
      connRef.current = conn;

      conn.done
        .catch((e) => {
          if (!mountedRef.current) return;
          setError((e as Error)?.message || "Stream error");
          // SSE 彻底失败：若有会话，走 get_state + get_entries 对账兜底。
          if (sessionKey) void reconcileFallback(sessionKey);
        })
        .finally(() => {
          if (mountedRef.current) setRunning(false);
        });
    },
    [opts.sessionKey, opts.agentId, safeSet, reconcileFallback],
  );

  const abort = useCallback(() => {
    connRef.current?.close();
    connRef.current = null;
    safeSet((s) => markAborted(s));
    setRunning(false);
    const sessionKey = opts.sessionKey;
    if (sessionKey) void runtimeApi.abort(sessionKey).catch(() => { /* 本地已置终态，后端失败忽略 */ });
  }, [opts.sessionKey, safeSet]);

  const loadHistory = useCallback(
    async (sessionKey: string) => {
      connRef.current?.close();
      connRef.current = null;
      setError(undefined);
      setRunning(false);
      try {
        const entries = await runtimeApi.getEntries(sessionKey);
        if (!mountedRef.current) return;
        setState(reduceAll(entriesToEvents(entries)));
      } catch (e) {
        if (!mountedRef.current) return;
        setError((e as Error)?.message || "Failed to load session history");
        setState(initialStreamState());
      }
    },
    [],
  );

  return { state, running, error, send, abort, loadHistory, reset };
}
