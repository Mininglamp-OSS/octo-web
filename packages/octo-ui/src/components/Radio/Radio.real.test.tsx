// @vitest-environment jsdom
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Radio, { RadioGroup } from './index'

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

describe('Radio with real Semi', () => {
  it('renders the real Semi DOM with Octo prefix classes', () => {
    const { container } = render(
      <Radio defaultChecked extra="More" name="status" value="active">
        Active
      </Radio>,
    )

    expect(container.querySelector('.octo-ui-radio')).not.toBeNull()
    expect(container.querySelector('.octo-ui-radio-semi-checked')).not.toBeNull()
    expect(container.querySelector('.octo-ui-radio-semi-inner-display')).not.toBeNull()
    expect(container.querySelector('.octo-ui-radio-semi-addon')?.textContent).toBe('Active')
    expect(container.querySelector('.octo-ui-radio-semi-extra')?.textContent).toBe('More')
    expect(container.querySelector('input[type="radio"]')).not.toBeNull()
  })

  it('forwards group changes through onValueChange', () => {
    const onValueChange = vi.fn()
    const { container } = render(
      <RadioGroup name="status" value="manual" onValueChange={onValueChange}>
        <Radio value="manual">Manual</Radio>
        <Radio value="automatic">Automatic</Radio>
      </RadioGroup>,
    )

    const radios = container.querySelectorAll('input[type="radio"]')
    act(() => {
      ;(radios[1] as HTMLInputElement).click()
    })

    expect(onValueChange).toHaveBeenCalledWith('automatic', expect.any(Object))
  })
})
