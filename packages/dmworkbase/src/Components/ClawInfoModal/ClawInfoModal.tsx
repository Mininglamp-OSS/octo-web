import React, { useState, useEffect } from "react";
import { Spin, Empty } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import ClawSessionItem from "../ClawSessionItem";
import ClawOverviewTab from "../ClawOverviewTab/ClawOverviewTab";
import ClawCoreFilesTab from "../ClawCoreFilesTab/ClawCoreFilesTab";
import "./ClawInfoModal.css";

export interface ClawInfoModalProps {
  /** Bot ID（如 pipixia_bot） */
  botId: string;
  /** 是否显示弹窗 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

export interface SessionData {
  key: string;
  status: "active" | "idle" | "closed";
  running: boolean;
  channel: string;
  party: string;
  botName: string;
  botId: string;
  model: string;
  ctxUsed: number;
  ctxMax: number;
  sessionId: string;
  lastMsg: string;
}

export interface AgentCardData {
  bot_id: string;
  session_total: number;
  session_running_count: number;
  sessions: Array<{
    session_id: string;
    session_key: string;
    channel: string;
    status: string;
    peer_name: string;
    peer_type: string;
    group_member_count: number | null;
    model: string;
    context_used: number;
    context_total: number;
    context_percent: number;
    last_user_message: string;
    last_active_at: string;
  }>;
  runtime_info: {
    gateway_name: string;
    claw_id: string;
    process_status: string;
    gateway_status?: string;
    os_version?: string;
    arch?: string;
    disk_space_gb?: number;
    memory_gb?: number;
    app_data_dir?: string;
    claw_version?: string;
    admin_url?: string;
    team_name?: string;
    gateway_total_agents?: number;
    gateway_alive_agents?: number;
    nodejs_version?: string;
    network_latency_ms?: number;
    last_heartbeat_at?: string;
    memory_retention_count?: number;
    memory_retention_note?: string;
  };
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
export default function ClawInfoModal({ botId, visible, onClose }: ClawInfoModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AgentCardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "session" | "files">("session");

  useEffect(() => {
    if (visible && botId) {
      loadAgentCard();
    }
  }, [visible, botId]);

  const loadAgentCard = async () => {
    setLoading(true);
    setError(null);
    try {
      // TODO: 从环境变量或配置读取 CARD_BASE_URL
      const baseUrl = process.env.REACT_APP_CARD_BASE_URL || "http://localhost:8080";
      const token = localStorage.getItem("token") || "";

      const response = await fetch(`${baseUrl}/api/v1/agent-cards/${botId}`, {
        headers: {
          Token: token,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.code === 0) {
        setData(result.data);
      } else {
        throw new Error(result.message || "获取数据失败");
      }
    } catch (err: any) {
      setError(err.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

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

    // 状态映射
    const statusMap: Record<string, "active" | "idle" | "closed"> = {
      running: "active",
      idle: "idle",
      stopped: "closed",
    };
    const mappedStatus = statusMap[s.status] || "idle";

    return {
      key: s.session_key,
      status: mappedStatus,
      running: s.status === "running",
      channel: channelDisplay,
      party: s.peer_name,
      botName: "未知 Bot", // 从 API 数据中提取（暂时用占位）
      botId: botId,
      model: s.model,
      ctxUsed: s.context_used,
      ctxMax: s.context_total,
      sessionId: s.session_id,
      lastMsg: s.last_user_message,
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
            <span> · 共 {total} 个（最近 1 小时）</span>
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
            description="最近 1 小时内没有活跃的会话，有新对话产生后会出现在这里"
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
              <h1>{data?.runtime_info?.gateway_name || "加载中..."}</h1>
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
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="claw-info-tabs">
          <button
            className={`claw-info-tab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
            data-testid="tab-overview"
          >
            概览
          </button>
          <button
            className={`claw-info-tab ${activeTab === "session" ? "active" : ""}`}
            onClick={() => setActiveTab("session")}
            data-testid="tab-session"
          >
            Session 信息
          </button>
          <button
            className={`claw-info-tab ${activeTab === "files" ? "active" : ""}`}
            onClick={() => setActiveTab("files")}
            data-testid="tab-files"
          >
            核心文件
          </button>
        </div>

        {/* Tab Content */}
        <div className="claw-info-content">
          {activeTab === "session" && renderSessionTab()}
          {activeTab === "overview" && data?.runtime_info && (
            <ClawOverviewTab
              runtimeInfo={{
                os_version: data.runtime_info.os_version || "—",
                arch: data.runtime_info.arch || "—",
                disk_space_gb: data.runtime_info.disk_space_gb || 0,
                memory_gb: data.runtime_info.memory_gb || 0,
                app_data_dir: data.runtime_info.app_data_dir || "—",
                claw_version: data.runtime_info.claw_version || "—",
                admin_url: data.runtime_info.admin_url || "—",
                team_name: data.runtime_info.team_name || "—",
                process_status: data.runtime_info.process_status,
                gateway_status: data.runtime_info.gateway_status || "unknown",
                gateway_name: data.runtime_info.gateway_name,
                claw_id: data.runtime_info.claw_id,
                gateway_total_agents: data.runtime_info.gateway_total_agents || 0,
                gateway_alive_agents: data.runtime_info.gateway_alive_agents || 0,
                nodejs_version: data.runtime_info.nodejs_version || "—",
                network_latency_ms: data.runtime_info.network_latency_ms || 0,
                last_heartbeat_at: data.runtime_info.last_heartbeat_at || "—",
                memory_retention_count: data.runtime_info.memory_retention_count || 0,
                memory_retention_note: data.runtime_info.memory_retention_note || "—",
              }}
              loading={loading}
              onRecheck={loadAgentCard}
            />
          )}
          {activeTab === "files" && (
            <ClawCoreFilesTab botId={botId} height="100%" />
          )}
        </div>
      </div>
    </WKModal>
  );
}
