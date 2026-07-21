// @octo/loop — Agent Runtime 面板（顶层装配）
//
// 把会话列表 / prompt 输入 / verbose 三档 / chat⇄code 一键切 / 富 diff / checkpoint
// 时间线接到 useAgentStream 上。diff / checkpoint / rollback 相关端点「待后端确认」，
// 这里按契约调用，失败降级为空态 + 错误提示，不阻断聊天主流程。

import React, { useCallback, useEffect, useState } from "react";
import { Send, Square, MessagesSquare, Code2, AlertTriangle } from "lucide-react";
import { useAgentStream } from "./useAgentStream";
import * as runtimeApi from "../api/agentRuntime/agentRuntimeApi";
import type { AgentSessionSummary, FileDiff, Checkpoint } from "../api/agentRuntime/contracts";
import SessionList from "./SessionList";
import VerboseRenderer, { type VerboseLevel } from "./VerboseRenderer";
import DiffView from "./DiffView";
import CheckpointTimeline from "./CheckpointTimeline";
import "./panel.css";

type Mode = "chat" | "code";

export interface AgentRuntimePanelProps {
  agentId?: string;
  initialSessionKey?: string;
}

export default function AgentRuntimePanel({ agentId, initialSessionKey }: AgentRuntimePanelProps) {
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeKey, setActiveKey] = useState<string | undefined>(initialSessionKey);
  const [verbose, setVerbose] = useState<VerboseLevel>("on");
  const [mode, setMode] = useState<Mode>("chat");
  const [draft, setDraft] = useState("");

  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [ckptLoading, setCkptLoading] = useState(false);

  const stream = useAgentStream({ sessionKey: activeKey, agentId });

  // 会话列表。
  useEffect(() => {
    let alive = true;
    setSessionsLoading(true);
    runtimeApi
      .listSessions({ agentId })
      .then((rows) => alive && setSessions(rows))
      .catch(() => alive && setSessions([]))
      .finally(() => alive && setSessionsLoading(false));
    return () => {
      alive = false;
    };
  }, [agentId]);

  const selectSession = useCallback(
    (key: string) => {
      setActiveKey(key);
      void stream.loadHistory(key);
    },
    [stream],
  );

  // code 模式：拉 diff + checkpoint（端点待后端确认，失败静默降级）。
  const refreshCode = useCallback(async () => {
    if (!activeKey) return;
    setDiffLoading(true);
    setCkptLoading(true);
    const [d, c] = await Promise.all([
      runtimeApi.getDiff({ sessionKey: activeKey }).catch(() => [] as FileDiff[]),
      runtimeApi.listCheckpoints(activeKey).catch(() => [] as Checkpoint[]),
    ]);
    setDiffs(d);
    setCheckpoints(c);
    setDiffLoading(false);
    setCkptLoading(false);
  }, [activeKey]);

  useEffect(() => {
    if (mode === "code") void refreshCode();
  }, [mode, refreshCode]);

  const onRollback = useCallback(
    async (checkpointId: string) => {
      if (!activeKey) return;
      await runtimeApi.rollback(activeKey, checkpointId).catch(() => { /* 待后端确认：失败提示交由上层 */ });
      await refreshCode();
    },
    [activeKey, refreshCode],
  );

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || stream.running) return;
    setDraft("");
    stream.send(text);
  }, [draft, stream]);

  return (
    <div className="loop-art-root">
      <aside className="loop-art-sidebar">
        <SessionList sessions={sessions} activeKey={activeKey} onSelect={selectSession} loading={sessionsLoading} />
      </aside>

      <main className="loop-art-main">
        <header className="loop-art-toolbar">
          {/* chat ⇄ code 一键切 */}
          <div className="loop-art-modes">
            <button type="button" className={`loop-art-mode ${mode === "chat" ? "active" : ""}`} onClick={() => setMode("chat")}>
              <MessagesSquare size={14} /> Chat
            </button>
            <button type="button" className={`loop-art-mode ${mode === "code" ? "active" : ""}`} onClick={() => setMode("code")}>
              <Code2 size={14} /> Code
            </button>
          </div>

          {/* verbose 三档 */}
          <div className="loop-art-verbose">
            {(["off", "on", "full"] as VerboseLevel[]).map((lv) => (
              <button key={lv} type="button" className={`loop-art-vbtn ${verbose === lv ? "active" : ""}`} onClick={() => setVerbose(lv)}>
                {lv}
              </button>
            ))}
          </div>

          {/* abort 在跑 turn */}
          {stream.running && (
            <button type="button" className="loop-art-abort" onClick={stream.abort} title="Abort current turn">
              <Square size={13} /> Stop
            </button>
          )}
        </header>

        {/* 回放不可用降级：可能有事件缺失 */}
        {stream.state.maybeMissingEvents && (
          <div className="loop-art-warn">
            <AlertTriangle size={14} /> Some events may be missing (stream replay unavailable — reconciled from server state).
          </div>
        )}
        {stream.error && <div className="loop-art-error">{stream.error}</div>}

        <div className="loop-art-content">
          {mode === "chat" ? (
            <VerboseRenderer state={stream.state} level={verbose} />
          ) : (
            <div className="loop-art-code">
              <section className="loop-art-diff">
                <h4>Changes</h4>
                {diffLoading ? <div className="loop-art-hint">Loading diff…</div> : <DiffView diffs={diffs} />}
              </section>
              <section className="loop-art-ckpt">
                <h4>Checkpoints</h4>
                <CheckpointTimeline checkpoints={checkpoints} loading={ckptLoading} onRollback={onRollback} />
              </section>
            </div>
          )}
        </div>

        {mode === "chat" && (
          <footer className="loop-art-composer">
            <textarea
              className="loop-art-input"
              value={draft}
              placeholder="Send a prompt…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <button type="button" className="loop-art-send" onClick={submit} disabled={!draft.trim() || stream.running}>
              <Send size={14} /> Send
            </button>
          </footer>
        )}
      </main>
    </div>
  );
}
