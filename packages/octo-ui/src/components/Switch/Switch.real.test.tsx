// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Switch from './index'

vi.hoisted(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  if (typeof HTMLCanvasElement !== 'undefined') {
    const context2d = new Proxy({}, { get: () => () => {} })
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext: (contextId: string) => unknown
    }
    proto.getContext = (contextId: string) => (contextId === '2d' ? context2d : null)
  }
})

let container: HTMLDivElement | null = null
let mountedRoot: ReturnType<typeof createRoot> | null = null

function render(element: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  mountedRoot = createRoot(container)
  act(() => {
    mountedRoot?.render(element)
  })
  return { container }
}

function getSwitchInput(root: HTMLElement) {
  return root.querySelector('input[role="switch"]') as HTMLInputElement
}

function getSwitchRoot(root: HTMLElement) {
  return root.querySelector('.octo-ui-switch') as HTMLElement
}

afterEach(() => {
  if (!container) return
  act(() => {
    mountedRoot?.unmount()
  })
  document.body.removeChild(container)
  container = null
  mountedRoot = null
})

describe('Switch with real Semi', () => {
  it('renders the real Semi DOM with Octo root classes', () => {
    const { container } = render(
      <Switch defaultChecked aria-label="Enable notifications" />,
    )

    expect(container.querySelector('.octo-ui-switch')).not.toBeNull()
    expect(container.querySelector('.octo-ui-switch--md')).not.toBeNull()
    expect(container.querySelector('.semi-switch-checked')).not.toBeNull()
    expect(container.querySelector('.semi-switch-knob')).not.toBeNull()
    expect(container.querySelector('input[role="switch"]')).not.toBeNull()
  })

  it('forwards changes through onChange and onCheckedChange', () => {
    const onChange = vi.fn()
    const onCheckedChange = vi.fn()
    const { container } = render(
      <Switch aria-label="Enable" onChange={onChange} onCheckedChange={onCheckedChange} />,
    )

    const input = getSwitchInput(container)
    act(() => {
      input.click()
    })

    expect(onChange).toHaveBeenCalledWith(true, expect.any(Object))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.any(Object))
  })

  it('does not fire callbacks when disabled or loading', () => {
    const onDisabledChange = vi.fn()
    const disabledRender = render(
      <Switch aria-label="Disabled switch" disabled onChange={onDisabledChange} />,
    )

    act(() => {
      getSwitchInput(disabledRender.container).click()
    })

    expect(onDisabledChange).not.toHaveBeenCalled()

    act(() => {
      mountedRoot?.unmount()
    })
    document.body.removeChild(disabledRender.container)
    container = null
    mountedRoot = null

    const onLoadingChange = vi.fn()
    const loadingRender = render(
      <Switch aria-label="Loading switch" loading onChange={onLoadingChange} />,
    )

    act(() => {
      getSwitchInput(loadingRender.container).click()
    })

    expect(onLoadingChange).not.toHaveBeenCalled()
  })

  it('keeps controlled state from changing until the checked prop changes', () => {
    const onChange = vi.fn()
    const { container } = render(
      <Switch aria-label="Controlled switch" checked={false} onChange={onChange} />,
    )

    act(() => {
      getSwitchInput(container).click()
    })

    expect(onChange).toHaveBeenCalledWith(true, expect.any(Object))
    expect(getSwitchRoot(container).classList.contains('semi-switch-checked')).toBe(false)
  })

  it('updates uncontrolled state after click', () => {
    const { container } = render(
      <Switch aria-label="Uncontrolled switch" />,
    )

    act(() => {
      getSwitchInput(container).click()
    })

    expect(getSwitchRoot(container).classList.contains('semi-switch-checked')).toBe(true)
  })

  it('exposes an enabled native switch input', () => {
    const { container } = render(
      <Switch aria-label="Keyboard switch" />,
    )

    const input = getSwitchInput(container)
    expect(input.type).toBe('checkbox')
    expect(input.disabled).toBe(false)
    expect(input.getAttribute('role')).toBe('switch')
  })
})
