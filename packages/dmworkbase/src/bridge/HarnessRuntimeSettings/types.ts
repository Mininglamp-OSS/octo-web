import type { HarnessRuntimeSettingsLabels } from '../../ui/HarnessRuntimeSettings/types'

export interface HarnessRuntimeSettingsBridgeOptions {
  labels: HarnessRuntimeSettingsLabels
  locale: string
  origin: string
  agentWorkerURL: string
}
