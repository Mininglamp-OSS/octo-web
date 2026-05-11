import React from 'react';
import ClawConfigItem from '../ClawConfigItem';
import ClawHealthCheckItem, { HealthStatus } from '../ClawHealthCheckItem';
import {
  Monitor,
  Cpu,
  HardDrive,
  FolderOpen,
  Package,
  Globe,
  Users,
} from 'lucide-react';
import type { RuntimeInfo } from '../../Service/AgentCardService';
import './ClawOverviewTab.css';
export interface ClawOverviewTabProps {
  /** 运行时信息数据 */
  runtimeInfo: RuntimeInfo;
  /** 加载状态 */
  loading?: boolean;
  /** 重新检查健康状态的回调 */
  onRecheck?: () => void;
}

/**
 * ClawOverviewTab - 龙虾信息概览 Tab
 * 
 * 展示 OpenClaw 配置信息和健康检查状态
 * 复用 ClawConfigItem 和 ClawHealthCheckItem 组件
 */
export default function ClawOverviewTab({
  runtimeInfo,
  loading = false,
  onRecheck,
}: ClawOverviewTabProps) {
  // 计算健康检查状态
  const getProcessStatus = (): HealthStatus => {
    return runtimeInfo.process_status === 'running' ? 'success' : 'error';
  };

  const getGatewayStatus = (): HealthStatus => {
    if (runtimeInfo.gateway_status !== 'connected') return 'error';
    if (runtimeInfo.network_latency_ms != null && runtimeInfo.network_latency_ms > 100) return 'warning';
    return 'success';
  };

  const getNodejsStatus = (): HealthStatus => {
    // Node.js 版本存在即为正常
    return runtimeInfo.nodejs_version ? 'success' : 'error';
  };

  const getMemoryStatus = (): HealthStatus => {
    // 内存大于 4GB 视为正常
    return runtimeInfo.memory_gb >= 4 ? 'success' : 'warning';
  };

  if (loading) {
    return (
      <div className="claw-overview-tab" data-testid="claw-overview-tab-loading">
        <div className="claw-overview-tab__loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="claw-overview-tab" data-testid="claw-overview-tab">
      {/* OpenClaw 配置信息卡片 */}
      <div className="config-card" data-testid="config-card">
        <div className="config-card__header">
          <h2 className="config-card__title">OpenClaw 配置信息</h2>
        </div>
        <div className="config-card__grid">
          <ClawConfigItem
            icon={<Monitor />}
            label="系统版本"
            value={runtimeInfo.os_version}
          />
          <ClawConfigItem
            icon={<Cpu />}
            label="处理器架构"
            value={runtimeInfo.arch}
          />
          <ClawConfigItem
            icon={<HardDrive />}
            label="可写磁盘空间"
            value={`${runtimeInfo.disk_space_gb.toFixed(1)} GB`}
          />
          <ClawConfigItem
            icon={<FolderOpen />}
            label="应用数据目录"
            value={runtimeInfo.app_data_dir}
          />
          <ClawConfigItem
            icon={<Package />}
            label="OpenClaw 版本"
            value={runtimeInfo.claw_version}
          />
          <ClawConfigItem
            icon={<Globe />}
            label="后台地址"
            value={runtimeInfo.admin_url}
          />
          <ClawConfigItem
            icon={<Users />}
            label="积分来源团队"
            value={runtimeInfo.team_name}
          />
        </div>
      </div>

      {/* 健康检查卡片 */}
      <div className="health-card" data-testid="health-card">
        <div className="health-card__header">
          <h2 className="health-card__title">健康检查</h2>
          <span className="health-card__summary">
            本地环境 {runtimeInfo.gateway_alive_agents}/{runtimeInfo.gateway_total_agents}
          </span>
          {onRecheck && (
            <button
              className="health-card__recheck-btn"
              onClick={onRecheck}
              data-testid="recheck-button"
            >
              重新检查
            </button>
          )}
        </div>
        <div className="health-card__chips" data-testid="health-chips">
          <ClawHealthCheckItem
            status={getProcessStatus()}
            label="OpenClaw 进程"
            value={runtimeInfo.process_status === 'running' ? '运行中' : '已停止'}
          />
          <ClawHealthCheckItem
            status={getGatewayStatus()}
            label="网关连接"
            value={
              runtimeInfo.gateway_status === 'connected'
                ? runtimeInfo.network_latency_ms != null
                  ? `延迟 ${runtimeInfo.network_latency_ms.toFixed(2)}ms`
                  : '已连接'
                : '未连接'
            }
          />
          <ClawHealthCheckItem
            status={getNodejsStatus()}
            label="Node.js"
            value={runtimeInfo.nodejs_version}
          />
          <ClawHealthCheckItem
            status={getMemoryStatus()}
            label="内存"
            value={`${runtimeInfo.memory_gb.toFixed(0)}GB`}
          />
        </div>
      </div>
    </div>
  );
}
