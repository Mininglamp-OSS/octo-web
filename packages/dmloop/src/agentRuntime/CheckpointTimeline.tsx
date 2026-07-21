// @octo/loop — checkpoint 时间线 + 回滚
//
// ⚠️ checkpoint / rollback 端点与字段「待后端确认」（见 agentRuntimeApi）。本组件仅按
// 前端预期契约渲染时间线并暴露回滚入口；回滚是破坏性操作，点按前需二次确认。

import React, { useState } from "react";
import { GitCommitHorizontal, RotateCcw, Loader2 } from "lucide-react";
import type { Checkpoint } from "../api/agentRuntime/contracts";
import "./checkpoint.css";

export interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
  loading?: boolean;
  // 回滚回调（由上层调 rollback 端点）。返回 Promise 以驱动行内 loading。
  onRollback: (checkpointId: string) => Promise<void> | void;
}

export default function CheckpointTimeline({ checkpoints, loading, onRollback }: CheckpointTimelineProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const doRollback = async (id: string) => {
    setBusyId(id);
    try {
      await onRollback(id);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  };

  if (loading) {
    return (
      <div className="loop-ckpt-loading">
        <Loader2 size={14} className="loop-spin" /> Loading checkpoints…
      </div>
    );
  }
  if (!checkpoints.length) return <div className="loop-ckpt-empty">No checkpoints</div>;

  return (
    <div className="loop-ckpt-timeline">
      {checkpoints.map((c) => (
        <div className="loop-ckpt-node" key={c.id}>
          <div className="loop-ckpt-rail">
            <GitCommitHorizontal size={16} className="loop-ckpt-dot" />
          </div>
          <div className="loop-ckpt-body">
            <div className="loop-ckpt-label">{c.label || `Checkpoint ${c.seq ?? ""}`}</div>
            <div className="loop-ckpt-meta">
              {c.created_at && <span>{c.created_at}</span>}
              {typeof c.files_changed === "number" && <span>{c.files_changed} files</span>}
            </div>
          </div>
          {confirmId === c.id ? (
            <div className="loop-ckpt-confirm">
              <span>Roll back to here?</span>
              <button type="button" className="loop-ckpt-btn danger" disabled={busyId === c.id} onClick={() => doRollback(c.id)}>
                {busyId === c.id ? <Loader2 size={12} className="loop-spin" /> : "Confirm"}
              </button>
              <button type="button" className="loop-ckpt-btn" onClick={() => setConfirmId(null)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="loop-ckpt-btn" onClick={() => setConfirmId(c.id)} title="Roll back to this checkpoint">
              <RotateCcw size={13} /> Rollback
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
