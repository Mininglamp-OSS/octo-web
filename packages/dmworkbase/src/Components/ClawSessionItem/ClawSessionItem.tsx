import React, { useState } from "react";
import "./ClawSessionItem.css";

export interface ClawSessionItemProps {
  /** Session 数据 */
  session: {
    /** Session key（如 octo:c_pipi_lux_01） */
    key: string;
    /** 状态（running | done | failed | killed | timeout） */
    status: "running" | "done" | "failed" | "killed" | "timeout";
    /** 渠道名称（如 Octo、Discord、飞书） */
    channel: string;
    /** 对话方原始名称/ID（如"7edea73a3c334a5382c0e0b6f27adbe0"，可选） */
    peerName?: string;
    /** 对话方展示名称（如"Octo 产品管家"，可选） */
    peerDisplayName?: string;
    /** Bot 显示名（如"皮皮虾"） */
    botName: string;
    /** Bot ID（如"pipixia_bot"） */
    botId: string;
    /** 模型名称 */
    model: string;
    /** 已使用上下文 */
    ctxUsed: number;
    /** 最大上下文 */
    ctxMax: number;
    /** SESSION ID */
    sessionId: string;
    /** 最近用户消息 */
    lastMsg: string;
  };
}

/**
 * ClawSessionItem - Session 展示卡片组件
 *
 * AC-5: 展示对话方、模型、上下文、最近消息
 * AC-6: 状态视觉标记（running=绿 / done=灰 / failed|killed|timeout=红）
 * AC-7: 点击表头展开/收起
 * AC-8: 上下文进度条 > 70% 显示警告色
 */
export default function ClawSessionItem({ session }: ClawSessionItemProps) {
  const [collapsed, setCollapsed] = useState(true); // 默认折叠

  const {
    key,
    status,
    channel,
    peerName,
    peerDisplayName,
    botName,
    botId,
    model,
    ctxUsed,
    ctxMax,
    sessionId,
    lastMsg,
  } = session;

  // 计算上下文占用百分比
  const ctxPercent = Math.round((ctxUsed / ctxMax) * 100);
  const isHighCtx = ctxPercent > 70;

  // 渠道 CSS 类（用于不同渠道的颜色标记）
  const channelClass = channel.toLowerCase().replace(/\s+/g, "-");

  // 状态配置映射
  const statusConfig = {
    running: { badge: "RUNNING", class: "running" },
    done: { badge: "DONE", class: "done" },
    failed: { badge: "FAILED", class: "failed" },
    killed: { badge: "KILLED", class: "failed" },
    timeout: { badge: "TIMEOUT", class: "failed" },
  }[status];

  const isRunning = status === "running";
  const statusClass = statusConfig?.class || "done";

  return (
    <div
      className={`wk-session-card wk-session-card--${statusClass} ${
        collapsed ? "collapsed" : ""
      }`}
      data-testid="claw-session-card"
    >
      {/* 头部（点击展开/收起） */}
      <div
        className="wk-session-head"
        onClick={() => setCollapsed(!collapsed)}
        data-testid="claw-session-head"
      >
        {/* 状态徽章 */}
        {statusConfig && (
          <span
            className={`wk-status-badge wk-status-badge--${statusClass}`}
            data-testid="claw-status-badge"
          >
            {statusConfig.badge}
          </span>
        )}

        {/* 渠道标签 */}
        <span
          className={`wk-channel-chip wk-channel-${channelClass}`}
          data-testid="claw-channel-chip"
        >
          {channel}
        </span>

        {/* 对话方 */}
        {(peerDisplayName || peerName) && (
          <span className="wk-session-party" data-testid="claw-session-party-head">
            {peerDisplayName || peerName}
            {peerDisplayName && peerName && (
              <span className="wk-session-party-id">
                ({peerName})
              </span>
            )}
          </span>
        )}

        {/* 展开/收起箭头 */}
        <svg
          className="wk-session-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="claw-session-chevron"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {/* 主体（可折叠） */}
      {!collapsed && (
        <>
          <div className="wk-session-body" data-testid="claw-session-body">
            {/* Session Key（占满 3 列） */}
            <div className="wk-session-field" style={{ gridColumn: "span 3" }}>
              <span className="wk-session-field__label">Session Key</span>
              <span
                className="wk-session-field__value"
                data-testid="claw-session-key"
              >
                {key}
              </span>
            </div>

            {/* Bot */}
            <div className="wk-session-field">
              <span className="wk-session-field__label">Bot</span>
              <span
                className="wk-session-field__value wk-session-field__value--normal"
                data-testid="claw-session-bot"
              >
                {botName}{" "}
                <span
                  style={{
                    color: "rgba(0, 0, 0, 0.35)",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    fontSize: "11px",
                  }}
                >
                  (@{botId})
                </span>
              </span>
            </div>

            {/* 模型 */}
            <div className="wk-session-field">
              <span className="wk-session-field__label">模型</span>
              <span
                className="wk-session-field__value"
                data-testid="claw-session-model"
              >
                {model}
              </span>
            </div>

            {/* SESSION ID（占 2 列） */}
            <div
              className="wk-session-field"
              style={{ gridColumn: "span 2" }}
            >
              <span className="wk-session-field__label">SESSION ID</span>
              <span
                className="wk-session-field__value"
                data-testid="claw-session-id"
              >
                {sessionId}
              </span>
            </div>

            {/* 上下文窗口（占满 3 列） */}
            <div className="wk-session-field wk-session-field--full">
              <span className="wk-session-field__label">上下文窗口</span>
              <div className="wk-context-bar" data-testid="claw-context-bar">
                {/* 进度条轨道 */}
                <div className="wk-context-bar__track">
                  <div
                    className={`wk-context-bar__fill ${
                      isHighCtx ? "warn" : ""
                    }`}
                    style={{ width: `${ctxPercent}%` }}
                    data-testid="claw-context-bar-fill"
                  />
                </div>
                {/* 百分比文本 */}
                <span
                  className="wk-context-bar__text"
                  data-testid="claw-context-bar-text"
                >
                  {(ctxUsed / 1000).toFixed(1)}K / {(ctxMax / 1000).toFixed(0)}
                  K ({ctxPercent}%)
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
