import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HarnessRuntimeSettings from './index'
import { English, Populated, SameDeviceProfiles } from './HarnessRuntimeSettings.stories'
import type { HarnessRuntimeSettingsProps } from './types'

vi.mock('../../Components/WKModal', () => ({ default: () => null }))

describe('HarnessRuntimeSettings runtime details', () => {
  it('shows different profiles for the same device and retains runtime IDs', () => {
    const props = SameDeviceProfiles.args as HarnessRuntimeSettingsProps
    render(<HarnessRuntimeSettings {...props} />)
    for (const runtime of props.runtimes) {
      expect(screen.getByText(runtime.profile!).getAttribute('title')).toBe(runtime.profile)
      expect(screen.getByText(runtime.id)).toBeTruthy()
    }
  })

  it('does not render a profile label for reports without a profile', () => {
    const props = Populated.args as HarnessRuntimeSettingsProps
    const { container } = render(<HarnessRuntimeSettings {...props} runtimes={[props.runtimes[1]]} />)
    expect(container.querySelector('.wk-harness-runtime-settings__profile')).toBeNull()
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
