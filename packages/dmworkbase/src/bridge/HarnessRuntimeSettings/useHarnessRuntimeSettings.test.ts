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
        owner_user_id: 'user-1',
        expires_at: '2026-09-15T12:00:00Z',
      })
      .mockResolvedValueOnce({
        enrollment_token: 'octo_enroll_second',
        octo_space_id: 'space-1',
        owner_user_id: 'user-1',
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

    act(() => current.onCloseAdd())
    act(() => current.onOpenAdd())
    await waitFor(() => expect(current.enrollment?.command).toContain('octo_enroll_second'))

    expect(service.createHarnessDeviceEnrollment).toHaveBeenCalledTimes(2)
  })
})
