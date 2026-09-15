import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { extractErrorMsg } from '../../Service/APIClient'
import {
  buildHarnessLoginCommand,
  buildHarnessProfile,
  createHarnessDeviceEnrollment,
  listHarnessRuntimes,
  type DeviceEnrollment,
  type HarnessRuntime,
} from '../../Service/HarnessRuntimeService'
import type {
  HarnessEnrollmentView,
  HarnessRuntimeListItem,
  HarnessRuntimeSettingsProps,
} from '../../ui/HarnessRuntimeSettings/types'
import type { HarnessRuntimeSettingsBridgeOptions } from './types'

function formatHeartbeat(value: string | undefined, locale: string, never: string, justNow: string): string {
  if (!value) return never
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return never
  const seconds = Math.round((time - Date.now()) / 1000)
  if (Math.abs(seconds) < 60) return justNow
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(seconds) < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (Math.abs(seconds) < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  return relative.format(Math.round(seconds / 86400), 'day')
}

function mapRuntime(runtime: HarnessRuntime, options: HarnessRuntimeSettingsBridgeOptions): HarnessRuntimeListItem {
  const device = [runtime.device?.hostname, runtime.device?.os, runtime.device?.arch].filter(Boolean).join(' · ')
  return {
    id: runtime.id,
    name: runtime.name,
    status: runtime.status,
    deviceLabel: device || runtime.device_id,
    runtimeVersion: runtime.runtime_version,
    lastHeartbeatLabel: formatHeartbeat(runtime.last_heartbeat_at, options.locale, options.labels.never, options.labels.justNow),
  }
}

export function useHarnessRuntimeSettings(options: HarnessRuntimeSettingsBridgeOptions): HarnessRuntimeSettingsProps {
  const [runtimes, setRuntimes] = useState<HarnessRuntime[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [enrollment, setEnrollment] = useState<DeviceEnrollment>()
  const [enrollmentLoading, setEnrollmentLoading] = useState(false)
  const [enrollmentError, setEnrollmentError] = useState('')
  const [commandCopied, setCommandCopied] = useState(false)
  const copyTimer = useRef<number>()

  const load = useCallback(async (initial = false, signal?: AbortSignal) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setLoadError('')
    try {
      setRuntimes(await listHarnessRuntimes(options.agentWorkerURL, signal))
    } catch (error) {
      if (signal?.aborted) return
      setLoadError(extractErrorMsg(error) || options.labels.requestFailed)
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [options.agentWorkerURL, options.labels.requestFailed])

  useEffect(() => {
    const controller = new AbortController()
    void load(true, controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
  }, [])

  const closeAdd = useCallback(() => {
    setAddOpen(false)
    setEnrollment(undefined)
    setEnrollmentError('')
    setCommandCopied(false)
    void load()
  }, [load])

  const createEnrollment = useCallback(async () => {
    setEnrollmentLoading(true)
    setEnrollmentError('')
    try {
      setEnrollment(await createHarnessDeviceEnrollment(options.agentWorkerURL))
    } catch (error) {
      setEnrollmentError(extractErrorMsg(error) || options.labels.requestFailed)
    } finally {
      setEnrollmentLoading(false)
    }
  }, [options.agentWorkerURL, options.labels.requestFailed])

  const enrollmentView = useMemo<HarnessEnrollmentView | undefined>(() => {
    if (!enrollment) return undefined
    const profile = buildHarnessProfile(enrollment.octo_space_id, enrollment.owner_user_id)
    return {
      expiresAtLabel: new Intl.DateTimeFormat(options.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(enrollment.expires_at)),
      command: buildHarnessLoginCommand({ profile, origin: options.origin, enrollmentToken: enrollment.enrollment_token, shell: 'posix' }),
    }
  }, [enrollment, options.locale, options.origin])

  const openAdd = useCallback(() => {
    setAddOpen(true)
    setEnrollment(undefined)
    setEnrollmentError('')
    setCommandCopied(false)
    void createEnrollment()
  }, [createEnrollment])

  const copyCommand = useCallback((value: string | undefined) => {
    if (!value || !navigator.clipboard?.writeText) return
    void navigator.clipboard.writeText(value).then(() => {
      setCommandCopied(true)
      if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCommandCopied(false), 1600)
    }).catch(() => undefined)
  }, [])

  return {
    labels: options.labels,
    runtimes: useMemo(() => runtimes.map((runtime) => mapRuntime(runtime, options)), [options, runtimes]),
    loading,
    refreshing,
    loadError: loadError || undefined,
    addOpen,
    enrollment: enrollmentView,
    enrollmentLoading,
    enrollmentError: enrollmentError || undefined,
    commandCopied,
    onRefresh: () => { void load() },
    onOpenAdd: openAdd,
    onCloseAdd: closeAdd,
    onRetryEnrollment: () => { void createEnrollment() },
    onCopyCommand: () => copyCommand(enrollmentView?.command),
  }
}
