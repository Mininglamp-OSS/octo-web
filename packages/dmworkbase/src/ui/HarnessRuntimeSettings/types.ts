export type HarnessRuntimeStatus = 'offline' | 'online' | 'degraded' | 'draining' | 'deregistered'

export type HarnessCommandShell = 'posix' | 'powershell'

export interface HarnessRuntimeListItem {
  id: string
  name: string
  profile?: string
  status: HarnessRuntimeStatus
  deviceLabel: string
  runtimeVersion?: string
  lastHeartbeatLabel: string
  providers: Array<{ type: string; version?: string }>
}

export interface HarnessEnrollmentView {
  expiresAtLabel: string
  command: string
  openClawCommand: string
}

export interface HarnessRuntimeSettingsLabels {
  title: string
  description: string
  addRuntime: string
  refresh: string
  runtimeList: string
  loading: string
  emptyTitle: string
  emptyDescription: string
  loadFailed: string
  retry: string
  runtimeVersion: string
  runtimeId: string
  profile: string
  providerVersionUnknown: string
  lastHeartbeat: string
  addTitle: string
  cancel: string
  creatingEnrollment: string
  expiresAt: string
  command: string
  commandDescription: string
  openClawSetup: string
  copyCommand: string
  copied: string
  done: string
  requestFailed: string
  never: string
  justNow: string
  status: Record<HarnessRuntimeStatus, string>
}

export interface HarnessRuntimeSettingsProps {
  className?: string
  labels: HarnessRuntimeSettingsLabels
  runtimes: HarnessRuntimeListItem[]
  loading: boolean
  refreshing?: boolean
  loadError?: string
  addOpen: boolean
  enrollment?: HarnessEnrollmentView
  enrollmentLoading?: boolean
  enrollmentError?: string
  commandCopied?: boolean
  openClawCommandCopied?: boolean
  onRefresh: () => void
  onOpenAdd: () => void
  onCloseAdd: () => void
  onRetryEnrollment: () => void
  onCopyCommand: () => void
  onCopyOpenClawCommand: () => void
}
