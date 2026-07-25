import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClawOverviewTab from './ClawOverviewTab';
import type { RuntimeInfo } from './ClawOverviewTab';

const mockRuntimeInfo: RuntimeInfo = {
  os_version: 'macOS 13.2.1',
  arch: 'arm64',
  disk_space_gb: 68.0,
  memory_gb: 32.0,
  app_data_dir: '.octopush/octopush-58d651',
  claw_version: 'v2026.4.11',
  admin_url: 'http://localhost:3100',
  team_name: 'DeepMiner Team',
  process_status: 'running',
  gateway_status: 'connected',
  gateway_name: 'Gateway-1',
  claw_id: 'claw-a8f3d2e1',
  gateway_total_agents: 10,
  gateway_alive_agents: 8,
  nodejs_version: 'v22.22.2',
  network_latency_ms: 45.2,
  last_heartbeat_at: '2026-05-07T10:31:00Z',
  memory_retention_count: 50,
  memory_retention_note: '保留最近50天记忆，已清理3条过期记录',
};

describe('ClawOverviewTab', () => {
  it('renders loading state', () => {
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} loading />);

    expect(screen.getByTestId('claw-overview-tab-loading')).toBeInTheDocument();
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders config card with runtime info', () => {
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} />);

    expect(screen.getByTestId('config-card')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw 配置信息')).toBeInTheDocument();

    // 验证配置项
    expect(screen.getByText('系统版本')).toBeInTheDocument();
    expect(screen.getByText('macOS 13.2.1')).toBeInTheDocument();

    expect(screen.getByText('处理器架构')).toBeInTheDocument();
    expect(screen.getByText('arm64')).toBeInTheDocument();

    expect(screen.getByText('可写磁盘空间')).toBeInTheDocument();
    expect(screen.getByText('68.0 GB')).toBeInTheDocument();

    expect(screen.getByText('应用数据目录')).toBeInTheDocument();
    expect(screen.getByText('.octopush/octopush-58d651')).toBeInTheDocument();

    expect(screen.getByText('OpenClaw 版本')).toBeInTheDocument();
    expect(screen.getByText('v2026.4.11')).toBeInTheDocument();

    expect(screen.getByText('后台地址')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3100')).toBeInTheDocument();

    expect(screen.getByText('积分来源团队')).toBeInTheDocument();
    expect(screen.getByText('DeepMiner Team')).toBeInTheDocument();
  });

  it('renders health card with health check items', () => {
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} />);

    expect(screen.getByTestId('health-card')).toBeInTheDocument();
    expect(screen.getByText('健康检查')).toBeInTheDocument();
    expect(screen.getByText('本地环境 8/10')).toBeInTheDocument();

    const healthChips = screen.getByTestId('health-chips');
    expect(healthChips).toBeInTheDocument();

    // 验证健康检查项
    expect(screen.getByText('OpenClaw 进程')).toBeInTheDocument();
    expect(screen.getByText('运行中')).toBeInTheDocument();

    expect(screen.getByText('网关连接')).toBeInTheDocument();
    expect(screen.getByText('延迟 45.20ms')).toBeInTheDocument();

    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('v22.22.2')).toBeInTheDocument();

    expect(screen.getByText('内存')).toBeInTheDocument();
    expect(screen.getByText('32GB')).toBeInTheDocument();
  });

  it('shows warning status for high latency', () => {
    const highLatencyInfo: RuntimeInfo = {
      ...mockRuntimeInfo,
      network_latency_ms: 126.43,
    };

    render(<ClawOverviewTab runtimeInfo={highLatencyInfo} />);

    expect(screen.getByText('延迟 126.43ms')).toBeInTheDocument();
  });

  it('shows error status when gateway disconnected', () => {
    const disconnectedInfo: RuntimeInfo = {
      ...mockRuntimeInfo,
      gateway_status: 'disconnected',
      process_status: 'idle',
    };

    render(<ClawOverviewTab runtimeInfo={disconnectedInfo} />);

    expect(screen.getByText('未连接')).toBeInTheDocument();
    expect(screen.getByText('已停止')).toBeInTheDocument();
  });

  it('renders recheck button when onRecheck provided', () => {
    const onRecheck = vi.fn();
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} onRecheck={onRecheck} />);

    const recheckBtn = screen.getByTestId('recheck-button');
    expect(recheckBtn).toBeInTheDocument();
    expect(recheckBtn).toHaveTextContent('重新检查');
  });

  it('calls onRecheck when recheck button clicked', async () => {
    const user = userEvent.setup();
    const onRecheck = vi.fn();
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} onRecheck={onRecheck} />);

    const recheckBtn = screen.getByTestId('recheck-button');
    await user.click(recheckBtn);

    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('does not render recheck button when onRecheck not provided', () => {
    render(<ClawOverviewTab runtimeInfo={mockRuntimeInfo} />);

    expect(screen.queryByTestId('recheck-button')).not.toBeInTheDocument();
  });

  it('formats numeric values correctly', () => {
    const customInfo: RuntimeInfo = {
      ...mockRuntimeInfo,
      disk_space_gb: 128.567,
      memory_gb: 16.234,
      network_latency_ms: 67.891,
    };

    render(<ClawOverviewTab runtimeInfo={customInfo} />);

    // 磁盘空间保留 1 位小数
    expect(screen.getByText('128.6 GB')).toBeInTheDocument();

    // 内存取整（只在健康检查 chip 中显示）
    expect(screen.getByText('16GB')).toBeInTheDocument();

    // 延迟保留 2 位小数
    expect(screen.getByText('延迟 67.89ms')).toBeInTheDocument();
  });
});
