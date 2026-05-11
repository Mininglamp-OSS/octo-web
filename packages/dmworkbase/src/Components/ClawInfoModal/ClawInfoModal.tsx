import React, { useState, useEffect } from "react";
import { Spin, Empty, Tooltip } from "@douyinfe/semi-ui";
import { IconClose } from "@douyinfe/semi-icons";
import { Clock } from "lucide-react";
import WKModal from "../WKModal";
import ClawSessionItem from "../ClawSessionItem";
import ClawOverviewTab from "../ClawOverviewTab/ClawOverviewTab";
import ClawCoreFilesTab from "../ClawCoreFilesTab/ClawCoreFilesTab";
import AgentCardService, { type AgentCardData } from "../../Service/AgentCardService";
import "./ClawInfoModal.css";

export interface ClawInfoModalProps {
  /** Bot ID（如 pipixia_bot） */
  botId: string;
  /** Bot 名称（如"皮皮虾"） */
  botName?: string;
  /** 是否显示弹窗 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

export interface SessionData {
  key: string;
  status: "running" | "done" | "failed" | "killed" | "timeout";
  channel: string;
  peerDisplayName?: string;
  peerName?: string;
  botName: string;
  botId: string;
  model: string;
  ctxUsed: number;
  ctxMax: number;
  sessionId: string;
  lastMsg: string;
  lastActiveAt: string;
}

/**
 * 格式化 ISO 8601 时间为 "2026-05-10 12:30:00"
 */
function formatDateTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 计算上报时间的新鲜度
 * @returns "green" | "orange" | "red"
 */
function getReportFreshness(lastReportAt: string): "green" | "orange" | "red" {
  const now = Date.now();
  const reportTime = new Date(lastReportAt).getTime();
  
  if (Number.isNaN(reportTime)) {
    return "red"; // 无效时间默认红色
  }
  
  const diffMs = now - reportTime;
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 2) return "green";
  if (diffHours < 6) return "orange";
  return "red";
}

/**
 * 计算相对时间文本（如"2小时前"）
 */
function getRelativeTime(isoString: string): string {
  const now = Date.now();
  const reportTime = new Date(isoString).getTime();
  
  if (Number.isNaN(reportTime)) {
    return "未知";
  }
  
  const diffMs = now - reportTime;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  return `${diffDays}天前`;
}

/**
 * ClawInfoModal - 龙虾详情弹窗
 *
 * PRD: Tab ② Session 信息
 * - 复用 ClawSessionItem 组件（已改造添加 Bot 字段）
 * - 顶部统计（X running · 共 Y 个）
 * - 空态处理
 * - 按 running 状态排序（running 在前）
 */
export default function ClawInfoModal({ botId, botName, visible, onClose }: ClawInfoModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AgentCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "session" | "files">("overview");

  useEffect(() => {
    let cancelled = false;
    
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // 使用 AgentCardService 统一走 axios + proxy
        const result = await AgentCardService.getAgentCard(botId);
        if (cancelled) return; // 如果已取消，忽略结果
        setData(result);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || "加载失败");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    if (visible && botId) {
      load();
    }
    
    return () => {
      cancelled = true;
    };
  }, [visible, botId]);

  // 弹窗关闭时只重置 tab，保留 data 避免 visible 快速切换时出现 loading 闪烁
  useEffect(() => {
    if (!visible) {
      setActiveTab("overview");
    }
  }, [visible]);

  // botId 变化时清空数据，防止显示上一个 bot 的旧内容
  useEffect(() => {
    setData(null);
    setError(null);
  }, [botId]);

  const mapToSessionData = (s: AgentCardData["sessions"][0]): SessionData => {
    // 渠道名称映射（中文）
    const channelMap: Record<string, string> = {
      dmwork: "dmwork",
      discord: "discord",
      feishu: "飞书",
      slack: "slack",
      localhost: "localhost",
    };
    const channelDisplay = channelMap[s.channel] || s.channel;

    // 对话类型映射（peer_type: private -> 私聊, group -> 群聊）
    const peerTypeMap: Record<string, string> = {
      private: "私聊",
      group: "群聊",
    };
    const peerTypeText = peerTypeMap[s.peer_type] || "";

    // 拼接渠道和对话类型：dmwork（私聊）
    const channelWithType = peerTypeText
      ? `${channelDisplay}（${peerTypeText}）`
      : channelDisplay;

    // 状态映射（直接使用 API 返回的状态值）
    const mappedStatus = (s.status as "running" | "done" | "failed" | "killed" | "timeout") || "done";

    return {
      key: s.session_key,
      status: mappedStatus,
      channel: channelWithType,
      peerDisplayName: s.peer_display_name,
      peerName: s.peer_name,
      botName: botName || "未知 Bot", // 使用传入的 Bot 名称
      botId: botId,
      model: s.model,
      ctxUsed: s.context_used,
      ctxMax: s.context_total,
      sessionId: s.session_id,
      lastMsg: s.last_user_message,
      lastActiveAt: s.last_active_at,
    };
  };

  const renderSessionTab = () => {
    if (loading) {
      return (
        <div className="claw-info-loading">
          <Spin size="large" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="claw-info-error">
          <Empty description={error} />
        </div>
      );
    }

    if (!data) {
      return null;
    }

    const sessions = data.sessions || [];
    const total = data.session_total || 0;
    const runningCount = data.session_running_count || 0;

    // 按 running 状态排序（running 在前）
    const sortedSessions = [...sessions].sort((a, b) => {
      const aRunning = a.status === "running" ? 1 : 0;
      const bRunning = b.status === "running" ? 1 : 0;
      return bRunning - aRunning;
    });

    return (
      <div className="claw-session-tab">
        {/* 顶部统计 */}
        <div className="claw-session-toolbar">
          <span className="claw-session-count">
            <span className="claw-session-count__running">{runningCount} running</span>
            <span> · 共 {total} 个</span>
          </span>
        </div>

        {/* Session 列表 */}
        {sortedSessions.length > 0 ? (
          <div className="claw-session-list" data-testid="claw-session-list">
            {sortedSessions.map((s) => (
              <ClawSessionItem key={s.session_id} session={mapToSessionData(s)} />
            ))}
          </div>
        ) : (
          <Empty
            image={
              <svg
                width="64"
                height="64"
                viewBox="0 0 64 64"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <circle cx="32" cy="32" r="28" stroke="#E5E7EB" strokeWidth="2" />
                <path
                  d="M22 34c0-2 2-4 4-4h12c2 0 4 2 4 4"
                  stroke="#D1D5DB"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="24" cy="24" r="2" fill="#D1D5DB" />
                <circle cx="40" cy="24" r="2" fill="#D1D5DB" />
              </svg>
            }
            description="暂无活跃的会话，有新对话产生后会出现在这里"
            style={{ padding: "60px 24px" }}
          />
        )}
      </div>
    );
  };

  return (
    <WKModal
      visible={visible}
      onCancel={onClose}
      title={null}
      size="full"
      className="claw-info-modal"
    >
      <div className="claw-info-container">
        {/* Header */}
        <div className="claw-info-header">
          <div className="claw-info-title-row">
            <div className="claw-info-title">
              <h1>{botName || data?.runtime_info?.gateway_name || "加载中..."}</h1>
              <div className="claw-info-meta">
                <span>所属 Gateway: {data?.runtime_info?.gateway_name || "—"}</span>
                <span className="claw-info-meta__sep">·</span>
                <span>ID: {data?.runtime_info?.claw_id || "—"}</span>
                <span className="claw-info-meta__sep">·</span>
                <span
                  className="claw-info-meta__status"
                  data-status={data?.runtime_info?.process_status || "unknown"}
                >
                  <span className="claw-info-meta__dot" />
                  {data?.runtime_info?.process_status === "running"
                    ? "运行中"
                    : data?.runtime_info?.process_status === "idle"
                    ? "空闲"
                    : "已关闭"}
                </span>
                {data?.last_report_at && (
                  <>
                    <span className="claw-info-meta__sep">·</span>
                    <Tooltip
                      content={`${getRelativeTime(data.last_report_at)}上报`}
                      position="bottom"
                    >
                      <span
                        className="claw-info-meta__report-time"
                        data-freshness={getReportFreshness(data.last_report_at)}
                        data-testid="claw-report-time"
                      >
                        <Clock size={14} className="claw-info-meta__report-time-icon" />
                        {formatDateTime(data.last_report_at)}
                      </span>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="claw-info-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "overview"}
            aria-controls="panel-overview"
            className={`claw-info-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
            data-testid="tab-overview"
          >
            概览
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "session"}
            aria-controls="panel-session"
            className={`claw-info-tab ${activeTab === "session" ? "active" : ""}`}
            onClick={() => setActiveTab("session")}
            data-testid="tab-session"
          >
            Session 信息
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "files"}
            aria-controls="panel-files"
            className={`claw-info-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => setActiveTab("files")}
            data-testid="tab-files"
          >
            核心文件
          </button>
        </div>

        {/* Tab Content */}
        <div className="claw-info-content">
          {activeTab === "session" && (
            <div id="panel-session" role="tabpanel" aria-labelledby="tab-session">
              {renderSessionTab()}
            </div>
          )}
          {activeTab === "overview" && (
            <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
              {loading ? (
                <div className="claw-info-loading">
                  <Spin size="large" />
                </div>
              ) : data?.runtime_info ? (
                <ClawOverviewTab
                  runtimeInfo={data.runtime_info}
                  loading={false}
                />
              ) : (
                <div className="claw-info-error">
                  <Empty description="加载失败" />
                </div>
              )}
            </div>
          )}
          {activeTab === "files" && (
            <div id="panel-files" role="tabpanel" aria-labelledby="tab-files">
              <ClawCoreFilesTab botId={botId} agentCardData={data} height="100%" />
            </div>
          )}
        </div>
      </div>
    </WKModal>
  );
}
