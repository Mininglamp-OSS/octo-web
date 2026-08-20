// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Checkbox from './index'

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

describe('Checkbox with real Semi', () => {
  it('renders the real Semi DOM with Octo prefix classes', () => {
    const { container } = render(<Checkbox defaultChecked extra="More">Enable</Checkbox>)

    expect(container.querySelector('.octo-ui-checkbox')).not.toBeNull()
    expect(container.querySelector('.octo-ui-checkbox-semi-checked')).not.toBeNull()
    expect(container.querySelector('.octo-ui-checkbox-semi-inner-display')).not.toBeNull()
    expect(container.querySelector('.octo-ui-checkbox-semi-addon')?.textContent).toBe('Enable')
    expect(container.querySelector('.octo-ui-checkbox-semi-extra')?.textContent).toBe('More')
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull()
  })

  it('forwards click changes through onCheckedChange', () => {
    const onCheckedChange = vi.fn()
    const { container } = render(<Checkbox onCheckedChange={onCheckedChange}>Enable</Checkbox>)

    act(() => {
      ;(container.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
    })

    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.any(Object))
  })
})
