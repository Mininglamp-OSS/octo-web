import React, { useState } from "react";
import "./SessionItem.css";

export interface SessionItemProps {
  /** Session 数据 */
  session: {
    /** Session key（如 octo:c_pipi_lux_01） */
    key: string;
    /** 状态（active | idle | closed） */
    status: "active" | "idle" | "closed";
    /** 是否正在运行 */
    running: boolean;
    /** 渠道名称（如 Octo、Discord、飞书） */
    channel: string;
    /** 对话方（如"罗敬为 · 皮皮虾(私聊)"） */
    party: string;
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
 * SessionItem - Session 展示卡片组件
 *
 * AC-5: 展示对话方、模型、上下文、最近消息
 * AC-6: RUNNING 状态强视觉标记（绿色左边框 + 渐变背景）
 * AC-7: 点击表头展开/收起
 * AC-8: 上下文进度条 > 70% 显示警告色
 */
export default function SessionItem({ session }: SessionItemProps) {
  const [collapsed, setCollapsed] = useState(false);

  const {
    key,
    status,
    running,
    channel,
    party,
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

  // 状态文本映射
  const statusText = {
    active: "活跃",
    idle: "空闲",
    closed: "已关闭",
  }[status];

  return (
    <div
      className={`wk-session-card ${running ? "is-running" : ""} ${
        collapsed ? "collapsed" : ""
      }`}
      data-testid="session-card"
    >
      {/* 头部（点击展开/收起） */}
      <div
        className="wk-session-head"
        onClick={() => setCollapsed(!collapsed)}
        data-testid="session-head"
      >
        {/* RUNNING 徽章（仅 running=true 时显示） */}
        {running && (
          <span className="wk-running-badge" data-testid="running-badge">
            RUNNING
          </span>
        )}

        {/* 渠道标签 */}
        <span
          className={`wk-channel-chip wk-channel-${channelClass}`}
          data-testid="channel-chip"
        >
          {channel}
        </span>

        {/* Session Key */}
        <span className="wk-session-key" data-testid="session-key">
          {key}
        </span>

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
          data-testid="session-chevron"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>

      {/* 主体（可折叠） */}
      {!collapsed && (
        <>
          <div className="wk-session-body" data-testid="session-body">
            {/* 对话方 */}
            <div className="wk-session-field">
              <span className="wk-session-field__label">对话方</span>
              <span
                className="wk-session-field__value wk-session-field__value--normal"
                data-testid="session-party"
              >
                {party}
              </span>
            </div>

            {/* 模型 */}
            <div className="wk-session-field">
              <span className="wk-session-field__label">模型</span>
              <span
                className="wk-session-field__value"
                data-testid="session-model"
              >
                {model}
              </span>
            </div>

            {/* SESSION ID */}
            <div className="wk-session-field">
              <span className="wk-session-field__label">SESSION ID</span>
              <span
                className="wk-session-field__value"
                data-testid="session-id"
              >
                {sessionId}
              </span>
            </div>

            {/* 上下文窗口（占满 3 列） */}
            <div className="wk-session-field wk-session-field--full">
              <span className="wk-session-field__label">上下文窗口</span>
              <div className="wk-context-bar" data-testid="context-bar">
                {/* 进度条轨道 */}
                <div className="wk-context-bar__track">
                  <div
                    className={`wk-context-bar__fill ${
                      isHighCtx ? "warn" : ""
                    }`}
                    style={{ width: `${ctxPercent}%` }}
                    data-testid="context-bar-fill"
                  />
                </div>
                {/* 百分比文本 */}
                <span
                  className="wk-context-bar__text"
                  data-testid="context-bar-text"
                >
                  {(ctxUsed / 1000).toFixed(1)}K / {(ctxMax / 1000).toFixed(0)}
                  K ({ctxPercent}%)
                </span>
              </div>
            </div>
          </div>

          {/* 最近消息 */}
          <div className="wk-session-msg" data-testid="session-msg">
            <span className="wk-session-msg__label">最近用户消息</span>
            <span className="wk-session-msg__content">{lastMsg}</span>
          </div>
        </>
      )}
    </div>
  );
}
