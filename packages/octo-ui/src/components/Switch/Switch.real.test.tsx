// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
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

  it('forwards changes through onCheckedChange', () => {
    const onCheckedChange = vi.fn()
    const { container } = render(
      <Switch aria-label="Enable" onCheckedChange={onCheckedChange} />,
    )

    const input = container.querySelector('input[role="switch"]') as HTMLInputElement
    act(() => {
      input.click()
    })

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.any(Object))
  })
})
