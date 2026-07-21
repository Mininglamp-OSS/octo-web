// @octo/loop — verbose 三档渲染
//
// off  : 只显示 assistant 最终文本
// on   : + 工具调用摘要（折叠：只显示工具名 + 一行入参摘要）
// full : + reasoning（thinking）+ 原始入参/出参 + 完整事件流（原样 JSON）
//
// 数据来自 streamReducer 归约后的 AgentStreamState，本组件只负责按档位挑选与展示。

import React, { useState } from "react";
import { ChevronRight, ChevronDown, Wrench, Brain, MessageSquare } from "lucide-react";
import type { AgentStreamState, StreamToolCall } from "./streamReducer";
import "./verbose.css";

export type VerboseLevel = "off" | "on" | "full";

function summarizeInput(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input.length > 80 ? `${input.slice(0, 80)}…` : input;
  try {
    const s = JSON.stringify(input);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return String(input);
  }
}

function pretty(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function ToolCallRow({ call, level }: { call: StreamToolCall; level: VerboseLevel }) {
  const [open, setOpen] = useState(false);
  const expandable = level === "full";
  return (
    <div className={`loop-verbose-tool status-${call.status}`}>
      <button
        type="button"
        className="loop-verbose-tool-head"
        onClick={() => expandable && setOpen((o) => !o)}
        disabled={!expandable}
      >
        {expandable ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <Wrench size={13} />}
        <span className="loop-verbose-tool-name">{call.name || "tool"}</span>
        <span className="loop-verbose-tool-summary">{summarizeInput(call.input)}</span>
        <span className={`loop-verbose-tool-status ${call.status}`}>{call.status}</span>
      </button>
      {expandable && open && (
        <div className="loop-verbose-tool-body">
          <div className="loop-verbose-kv">
            <div className="loop-verbose-k">input</div>
            <pre className="loop-verbose-pre">{pretty(call.input)}</pre>
          </div>
          {call.output !== undefined && (
            <div className="loop-verbose-kv">
              <div className="loop-verbose-k">output</div>
              <pre className="loop-verbose-pre">{pretty(call.output)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface VerboseRendererProps {
  state: AgentStreamState;
  level: VerboseLevel;
  // full 档「完整事件流」原样区（可选传入原始事件 JSON 列表）。
  rawEvents?: unknown[];
}

export default function VerboseRenderer({ state, level, rawEvents }: VerboseRendererProps) {
  const finalMessages = state.messages.filter((m) => m.role === "assistant" && m.text.trim());

  return (
    <div className="loop-verbose-root">
      {/* thinking：仅 full 档 */}
      {level === "full" && state.thinking.length > 0 && (
        <section className="loop-verbose-section">
          <div className="loop-verbose-section-title"><Brain size={13} /> Reasoning</div>
          {state.thinking.map((t) => (
            <pre key={t.id} className="loop-verbose-thinking">{t.text}</pre>
          ))}
        </section>
      )}

      {/* 工具调用：on / full 档 */}
      {level !== "off" && state.toolCalls.length > 0 && (
        <section className="loop-verbose-section">
          <div className="loop-verbose-section-title"><Wrench size={13} /> Tool calls</div>
          {state.toolCalls.map((c) => (
            <ToolCallRow key={c.id} call={c} level={level} />
          ))}
        </section>
      )}

      {/* 最终文本：所有档位都显示 */}
      <section className="loop-verbose-section">
        {level !== "off" && (
          <div className="loop-verbose-section-title"><MessageSquare size={13} /> Response</div>
        )}
        {finalMessages.length ? (
          finalMessages.map((m) => (
            <div key={m.id} className="loop-verbose-message">{m.text}</div>
          ))
        ) : (
          <div className="loop-verbose-empty">No response yet</div>
        )}
      </section>

      {/* 完整事件流：仅 full 档，原样 JSON */}
      {level === "full" && rawEvents && rawEvents.length > 0 && (
        <section className="loop-verbose-section">
          <div className="loop-verbose-section-title">Raw event stream ({rawEvents.length})</div>
          <pre className="loop-verbose-pre raw">{rawEvents.map((e) => pretty(e)).join("\n")}</pre>
        </section>
      )}

      {state.errorMessage && <div className="loop-verbose-error">{state.errorMessage}</div>}
    </div>
  );
}
