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
import { useI18n } from '../../i18n';
import { Loading } from '@octo/ui';
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
  const { t } = useI18n();

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
        <div className="claw-overview-tab__loading">
          <Loading text={t('base.claw.loading')} layout="vertical" />
        </div>
      </div>
    );
  }

  return (
    <div className="claw-overview-tab" data-testid="claw-overview-tab">
      {/* OpenClaw 配置信息卡片 */}
      <div className="config-card" data-testid="config-card">
        <div className="config-card__header">
          <h2 className="config-card__title">
            {t('base.claw.overview.configInfo')}
          </h2>
        </div>
        <div className="config-card__grid">
          <ClawConfigItem
            icon={<Monitor />}
            label={t('base.claw.overview.osVersion')}
            value={runtimeInfo.os_version}
          />
          <ClawConfigItem
            icon={<Cpu />}
            label={t('base.claw.overview.arch')}
            value={runtimeInfo.arch}
          />
          <ClawConfigItem
            icon={<HardDrive />}
            label={t('base.claw.overview.writableDiskSpace')}
            value={`${runtimeInfo.disk_space_gb.toFixed(1)} GB`}
          />
          <ClawConfigItem
            icon={<FolderOpen />}
            label={t('base.claw.overview.appDataDir')}
            value={runtimeInfo.app_data_dir}
          />
          <ClawConfigItem
            icon={<Package />}
            label={t('base.claw.overview.clawVersion')}
            value={runtimeInfo.claw_version}
          />
          <ClawConfigItem
            icon={<Globe />}
            label={t('base.claw.overview.adminUrl')}
            value={runtimeInfo.admin_url}
          />
          <ClawConfigItem
            icon={<Users />}
            label={t('base.claw.overview.teamName')}
            value={runtimeInfo.team_name}
          />
        </div>
      </div>

      {/* 健康检查卡片 */}
      <div className="health-card" data-testid="health-card">
        <div className="health-card__header">
          <h2 className="health-card__title">
            {t('base.claw.overview.healthCheck')}
          </h2>
          <span className="health-card__summary">
            {t('base.claw.overview.localEnvironment')} {runtimeInfo.gateway_alive_agents}/{runtimeInfo.gateway_total_agents}
          </span>
          {onRecheck && (
            <button
              className="health-card__recheck-btn"
              onClick={onRecheck}
            data-testid="recheck-button"
          >
              {t('base.claw.overview.recheck')}
            </button>
          )}
        </div>
        <div className="health-card__chips" data-testid="health-chips">
          <ClawHealthCheckItem
            status={getProcessStatus()}
            label={t('base.claw.overview.process')}
            value={runtimeInfo.process_status === 'running'
              ? t('base.claw.overview.running')
              : t('base.claw.overview.stopped')}
          />
          <ClawHealthCheckItem
            status={getGatewayStatus()}
            label={t('base.claw.overview.gatewayConnection')}
            value={
              runtimeInfo.gateway_status === 'connected'
                ? runtimeInfo.network_latency_ms != null
                  ? t('base.claw.overview.latency', {
                    values: { value: runtimeInfo.network_latency_ms.toFixed(2) },
                  })
                  : t('base.claw.overview.connected')
                : t('base.claw.overview.disconnected')
            }
          />
          <ClawHealthCheckItem
            status={getNodejsStatus()}
            label="Node.js"
            value={runtimeInfo.nodejs_version}
          />
          <ClawHealthCheckItem
            status={getMemoryStatus()}
            label={t('base.claw.overview.memory')}
            value={`${runtimeInfo.memory_gb.toFixed(0)}GB`}
          />
        </div>
      </div>
    </div>
  );
}
