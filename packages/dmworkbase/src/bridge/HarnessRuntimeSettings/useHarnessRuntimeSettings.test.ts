import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const service = vi.hoisted(() => ({
  createHarnessDeviceEnrollment: vi.fn(),
  listHarnessRuntimes: vi.fn(),
}))

vi.mock('../../Service/HarnessRuntimeService', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../Service/HarnessRuntimeService')>()
  return { ...original, ...service }
})

import type { HarnessRuntimeSettingsLabels, HarnessRuntimeSettingsProps } from '../../ui/HarnessRuntimeSettings/types'
import { useHarnessRuntimeSettings } from './useHarnessRuntimeSettings'

const labels = {
  requestFailed: 'Request failed',
  never: 'Never',
  justNow: 'Just now',
} as HarnessRuntimeSettingsLabels

describe('useHarnessRuntimeSettings', () => {
  beforeEach(() => {
    service.createHarnessDeviceEnrollment.mockReset()
    service.listHarnessRuntimes.mockReset().mockResolvedValue([])
    service.createHarnessDeviceEnrollment
      .mockResolvedValueOnce({
        enrollment_token: 'octo_enroll_first',
        octo_space_id: 'space-1',
        owner_ref: 'uid:user-1',
        kind: 'local',
        expires_at: '2026-09-15T12:00:00Z',
      })
      .mockResolvedValueOnce({
        enrollment_token: 'octo_enroll_second',
        octo_space_id: 'space-1',
        owner_ref: 'uid:user-1',
        kind: 'local',
        expires_at: '2026-09-15T12:05:00Z',
      })
  })

  it('creates a fresh enrollment every time Add device is opened', async () => {
    let current!: HarnessRuntimeSettingsProps
    function HookHarness() {
      current = useHarnessRuntimeSettings({
        agentWorkerURL: 'http://localhost:3000/agentworker',
        origin: 'http://localhost:3000',
        locale: 'en-US',
        labels,
      })
      return null
    }

    render(React.createElement(HookHarness))

    await waitFor(() => expect(current.loading).toBe(false))

    act(() => current.onOpenAdd())
    await waitFor(() => expect(current.enrollment?.command).toContain('octo_enroll_first'))
    expect(current.enrollment?.command).toContain("--profile 'space-1_user-1'")
    expect(current.enrollmentError).toBeUndefined()

    act(() => current.onCloseAdd())
    act(() => current.onOpenAdd())
    await waitFor(() => expect(current.enrollment?.command).toContain('octo_enroll_second'))

    expect(service.createHarnessDeviceEnrollment).toHaveBeenCalledTimes(2)
  })

  it('maps machine identity and available provider versions from the new runtime report', async () => {
    service.listHarnessRuntimes.mockResolvedValue([{
      id: 'runtime-1', machine_id: 'machine-1', owner_ref: 'uid:user-1', name: 'VPS', status: 'offline', device: {},
      capabilities: { adapters: [
        { available: true, provider_type: 'codex', provider_version: '0.149.1', provider_path: '/private/codex' },
        { available: true, provider_type: 'hermes', provider_version: null },
        { available: false, provider_type: 'kiro', provider_version: null },
      ] },
    }])
    let current!: HarnessRuntimeSettingsProps
    function HookHarness() {
      current = useHarnessRuntimeSettings({ agentWorkerURL: 'https://im-test.deepminer.com.cn/agentworker',
        origin: 'https://im-test.deepminer.com.cn', locale: 'en-US', labels })
      return null
    }
    render(React.createElement(HookHarness))
    await waitFor(() => expect(current.loading).toBe(false))
    expect(current.runtimes[0].deviceLabel).toBe('machine-1')
    expect(current.runtimes[0].providers).toEqual([
      { type: 'codex', version: '0.149.1' }, { type: 'hermes', version: undefined },
    ])
    expect(JSON.stringify(current.runtimes)).not.toContain('/private/codex')
  })
})
