// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Select from './index'

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

describe('Select with real Semi', () => {
  it('keeps Select.Option children selectable', () => {
    const rendered = render(
      <Select defaultOpen motion={false} getPopupContainer={() => container as HTMLDivElement}>
        <Select.Option value="one">One</Select.Option>
        <Select.Option value="two">Two</Select.Option>
      </Select>,
    )

    const options = rendered.container.querySelectorAll('.octo-ui-select-option')
    expect(options).toHaveLength(2)
    expect(options[0]?.textContent).toContain('One')
    expect(options[1]?.textContent).toContain('Two')
  })

  it('renders and wires the clear button when clearable', () => {
    const onChange = vi.fn()
    const rendered = render(
      <Select
        clearable
        clearAriaLabel="Clear selection"
        motion={false}
        defaultValue="one"
        onChange={onChange}
        optionList={[
          { value: 'one', label: 'One' },
        ]}
      />,
    )

    const clearButton = rendered.container.querySelector<HTMLButtonElement>('.octo-ui-select__clear')
    expect(clearButton).not.toBeNull()

    act(() => {
      clearButton?.click()
    })

    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('honors showTick=false from optionList', () => {
    const rendered = render(
      <Select
        defaultOpen
        motion={false}
        defaultValue="zh-CN"
        getPopupContainer={() => container as HTMLDivElement}
        optionList={[
          { value: 'zh-CN', label: 'ZH', showTick: false },
          { value: 'en-US', label: 'EN', showTick: false },
        ]}
      />,
    )

    expect(rendered.container.querySelector('.octo-ui-select-option--selected')).not.toBeNull()
    expect(rendered.container.querySelector('.octo-ui-select-option__check')).toBeNull()
  })

  it('renders keyboard focus state from Semi', () => {
    const rendered = render(
      <Select
        defaultOpen
        motion={false}
        getPopupContainer={() => container as HTMLDivElement}
        optionList={[
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two' },
        ]}
      />,
    )

    const trigger = rendered.container.querySelector<HTMLElement>('[role="combobox"]')
    expect(trigger).not.toBeNull()

    act(() => {
      trigger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })

    expect(rendered.container.querySelector('.octo-ui-select-option--focused')).not.toBeNull()
  })
})
