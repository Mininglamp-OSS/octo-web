// @octo/loop — 会话列表（切换会话）
import React from "react";
import { MessageSquare, Loader2 } from "lucide-react";
import type { AgentSessionSummary } from "../api/agentRuntime/contracts";
import "./sessionList.css";

export interface SessionListProps {
  sessions: AgentSessionSummary[];
  activeKey?: string;
  onSelect: (sessionKey: string) => void;
  loading?: boolean;
}

export default function SessionList({ sessions, activeKey, onSelect, loading }: SessionListProps) {
  return (
    <div className="loop-session-list">
      {loading && (
        <div className="loop-session-loading">
          <Loader2 size={14} className="loop-spin" /> Loading…
        </div>
      )}
      {!loading && sessions.length === 0 && (
        <div className="loop-session-empty">No sessions</div>
      )}
      {sessions.map((s) => (
        <button
          type="button"
          key={s.session_key}
          className={`loop-session-item ${s.session_key === activeKey ? "active" : ""}`}
          onClick={() => onSelect(s.session_key)}
        >
          <MessageSquare size={14} className="loop-session-ic" />
          <span className="loop-session-title">{s.title || s.session_key}</span>
          {s.running && <span className="loop-session-running">running</span>}
        </button>
      ))}
    </div>
  );
}
