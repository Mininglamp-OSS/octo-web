import React from 'react'
import WKApp from '../../App'
import { useHarnessRuntimeSettings } from '../../bridge/HarnessRuntimeSettings/useHarnessRuntimeSettings'
import { i18n, t } from '../../i18n'
import HarnessRuntimeSettings from '../../ui/HarnessRuntimeSettings'
import type { HarnessRuntimeSettingsLabels } from '../../ui/HarnessRuntimeSettings/types'
import { resolveWebOrigin } from '../../Utils/webOrigin'

function getLabels(): HarnessRuntimeSettingsLabels {
  const key = (name: string) => t(`base.navRail.settingsCenter.runtime.${name}`)
  return {
    title: key('title'), description: key('description'), addRuntime: key('addRuntime'), refresh: key('refresh'),
    runtimeList: key('runtimeList'), loading: key('loading'), emptyTitle: key('emptyTitle'), emptyDescription: key('emptyDescription'),
    loadFailed: key('loadFailed'), retry: key('retry'), runtimeVersion: key('runtimeVersion'), lastHeartbeat: key('lastHeartbeat'),
    providerVersionUnknown: key('providerVersionUnknown'),
    addTitle: key('addTitle'), cancel: key('cancel'), creatingEnrollment: key('creatingEnrollment'),
    expiresAt: key('expiresAt'), command: key('command'), commandDescription: key('commandDescription'),
    copyCommand: key('copyCommand'), copied: key('copied'), done: key('done'),
    requestFailed: key('requestFailed'),
    never: key('never'), justNow: key('justNow'),
    status: { offline: key('status.offline'), online: key('status.online'), degraded: key('status.degraded'), draining: key('status.draining'), deregistered: key('status.deregistered') },
  }
}

export default function HarnessRuntimeSettingsPage() {
  const origin = resolveWebOrigin(window.location.origin, WKApp.apiClient?.config?.apiURL)
  const agentWorkerURL = new URL('/agentworker', origin).href
  const props = useHarnessRuntimeSettings({ labels: getLabels(), locale: i18n.getLocale(), origin, agentWorkerURL })
  return <HarnessRuntimeSettings {...props} />
}
