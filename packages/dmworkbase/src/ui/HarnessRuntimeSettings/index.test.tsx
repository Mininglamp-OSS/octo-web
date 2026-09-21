import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HarnessRuntimeSettings from './index'
import { English, EnrollmentReady, Populated, SameDeviceProfiles } from './HarnessRuntimeSettings.stories'
import type { HarnessRuntimeSettingsProps } from './types'

vi.mock('../../Components/WKModal', () => ({
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible
    ? <div role="dialog">{children}</div>
    : null,
}))

describe('HarnessRuntimeSettings runtime details', () => {
  it('shows login and optional OpenClaw commands in the add-device dialog', () => {
    const props = EnrollmentReady.args as HarnessRuntimeSettingsProps
    const { container } = render(<HarnessRuntimeSettings {...props} />)
    expect(screen.getByText('设备登录命令')).toBeTruthy()
    expect(screen.getByText('OpenClaw 适配（可选）')).toBeTruthy()
    expect([...container.querySelectorAll('pre code')].map((element) => element.textContent)).toEqual([
      props.enrollment!.command, props.enrollment!.openClawCommand,
    ])
    expect(screen.getAllByRole('button', { name: '复制命令' })).toHaveLength(2)
  })

  it('hides profile data from cards and retains runtime IDs', () => {
    const props = SameDeviceProfiles.args as HarnessRuntimeSettingsProps
    render(<HarnessRuntimeSettings {...props} />)
    for (const runtime of props.runtimes) {
      expect(screen.queryByText(runtime.profile!)).toBeNull()
      expect(screen.getByText(runtime.id)).toBeTruthy()
    }
  })

  it('shows icons with version tooltips and hides the row for runtimes without providers', async () => {
    const { container } = render(<HarnessRuntimeSettings {...Populated.args as HarnessRuntimeSettingsProps} />)
    expect(container.querySelectorAll('.wk-harness-runtime-settings__providers')).toHaveLength(1)
    expect(container.querySelectorAll('.wk-harness-runtime-settings__provider')).toHaveLength(7)
    expect(screen.queryByRole('img', { name: /Kiro/ })).toBeNull()
    const codex = screen.getByRole('img', { name: 'Codex · 0.149.1' })
    expect(codex.getAttribute('tabindex')).toBe('0')
    await userEvent.hover(codex)
    await waitFor(() => expect(screen.getByText('Codex · 0.149.1')).toBeTruthy())
    expect(screen.getByRole('img', { name: 'Hermes · 版本未知' })).toBeTruthy()
  })

  it('localizes the missing version and keeps unknown available providers visible', () => {
    const props = English.args as HarnessRuntimeSettingsProps
    render(<HarnessRuntimeSettings {...props} runtimes={[{
      ...props.runtimes[0], providers: [{ type: 'hermes' }, { type: 'future-agent', version: '1.0.0' }],
    }]} />)
    expect(screen.getByRole('img', { name: 'Hermes · Version unknown' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'future-agent · 1.0.0' })).toBeTruthy()
  })
})
