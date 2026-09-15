import type { Meta, StoryObj } from '@storybook/react-vite'
import { buildHarnessLoginCommand } from '../../Service/HarnessRuntimeService'
import HarnessRuntimeSettings from './index'
import type { HarnessRuntimeSettingsProps } from './types'
import enUS from '../../i18n/locales/en-US.json'

const labels: HarnessRuntimeSettingsProps['labels'] = {
  title: '设备与运行时',
  description: '管理当前工作空间中运行 octo-harness 的设备。',
  addRuntime: '添加设备',
  refresh: '刷新',
  runtimeList: '已有运行时',
  loading: '正在加载运行时...',
  emptyTitle: '暂无运行时',
  emptyDescription: '在 VPS 或其他设备上完成配置后，运行时会显示在这里。',
  loadFailed: '无法加载运行时',
  retry: '重试',
  runtimeVersion: '版本',
  providerVersionUnknown: '版本未知',
  lastHeartbeat: '最近心跳',
  addTitle: '添加设备',
  cancel: '取消',
  creatingEnrollment: '正在生成设备授权...',
  expiresAt: '有效期至',
  command: '设备登录命令',
  commandDescription: '在需要添加的设备上运行此命令。',
  copyCommand: '复制命令',
  copied: '已复制',
  done: '完成',
  requestFailed: '请求失败，请稍后重试。',
  never: '从未',
  justNow: '刚刚',
  status: { offline: '离线', online: '在线', degraded: '异常', draining: '正在停止', deregistered: '已注销' },
}

const baseArgs: HarnessRuntimeSettingsProps = {
  labels,
  runtimes: [
    { id: 'rt_01K4M7F9TD5X4R', name: '北京开发 VPS', status: 'online', deviceLabel: 'dev-vps-01 · Linux x64', runtimeVersion: '0.4.0', lastHeartbeatLabel: '刚刚', providers: [
      { type: 'codex', version: '0.149.1' }, { type: 'claude-code', version: '2.1.272' },
      { type: 'codebuddy', version: '2.150.0' }, { type: 'hermes' },
      { type: 'kimi-code', version: '0.42.0' }, { type: 'opencode', version: '1.18.30' },
      { type: 'openclaw', version: '2026.9.4' },
    ] },
    { id: 'rt_01K4M7K6WA2P9B', name: '构建节点', status: 'offline', deviceLabel: 'build-node · Linux arm64', runtimeVersion: '0.3.8', lastHeartbeatLabel: '2 小时前', providers: [] },
  ],
  loading: false,
  addOpen: false,
  onRefresh: () => undefined,
  onOpenAdd: () => undefined,
  onCloseAdd: () => undefined,
  onRetryEnrollment: () => undefined,
  onCopyCommand: () => undefined,
}

const loginCommand = buildHarnessLoginCommand({
  profile: 'space_01_user_01',
  origin: 'https://im-test.deepminer.com.cn',
  enrollmentToken: 'octo_enroll_example',
  shell: 'posix',
})

const meta: Meta<typeof HarnessRuntimeSettings> = {
  title: 'Settings/HarnessRuntimeSettings',
  component: HarnessRuntimeSettings,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof HarnessRuntimeSettings>

export const Populated: Story = { args: baseArgs }
const englishLabels: HarnessRuntimeSettingsProps['labels'] = { ...labels, status: { ...labels.status } }
for (const key of Object.keys(labels) as Array<keyof typeof labels>) {
  if (key === 'status') {
    for (const status of Object.keys(labels.status) as Array<keyof typeof labels.status>) {
      englishLabels.status[status] = enUS[`navRail.settingsCenter.runtime.status.${status}` as keyof typeof enUS]
    }
  } else {
    englishLabels[key] = enUS[`navRail.settingsCenter.runtime.${key}` as keyof typeof enUS]
  }
}
export const English: Story = { args: {
  ...baseArgs,
  labels: englishLabels,
} }
export const Empty: Story = { args: { ...baseArgs, runtimes: [] } }
export const Loading: Story = { args: { ...baseArgs, runtimes: [], loading: true } }
export const Error: Story = { args: { ...baseArgs, runtimes: [], loadError: '请求失败，请稍后重试。' } }
export const AddRuntime: Story = { args: { ...baseArgs, addOpen: true, enrollmentLoading: true } }
export const EnrollmentReady: Story = {
  args: {
    ...baseArgs,
    addOpen: true,
    enrollment: {
      expiresAtLabel: '2026-09-14 18:30',
      command: loginCommand,
    },
  },
}
