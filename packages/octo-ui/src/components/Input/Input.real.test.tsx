// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Input from './index'

vi.hoisted(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

describe('Input.TextArea with real Semi', () => {
  it('normalizes readOnly to Semi readonly for input and textarea', () => {
    const { container } = render(
      <>
        <Input readOnly value="locked" />
        <Input.TextArea readOnly value="locked" />
      </>,
    )

    expect((container.querySelector('input') as HTMLInputElement).readOnly).toBe(true)
    expect((container.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true)
  })

  it('updates maxCount display for uncontrolled textareas', () => {
    const { container } = render(<Input.TextArea defaultValue="abc" maxCount={10} />)
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    expect(container.querySelector('.octo-ui-textarea__count')?.textContent).toBe('3/10')

    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, 'abcdef')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'def' }))
    })

    expect(container.querySelector('.octo-ui-textarea__count')?.textContent).toBe('6/10')
  })

  it('calls onEnterPress when Enter is pressed', () => {
    const onEnterPress = vi.fn()
    const { container } = render(<Input.TextArea onEnterPress={onEnterPress} />)
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(onEnterPress).toHaveBeenCalledTimes(1)
  })

  it('maps onPressEnter and skips composing or shifted Enter', () => {
    const onEnterPress = vi.fn()
    const onPressEnter = vi.fn()
    const { container } = render(
      <Input.TextArea allowWrap={false} onEnterPress={onEnterPress} onPressEnter={onPressEnter} />,
    )
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement

    act(() => {
      const composingEnter = new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })
      Object.defineProperty(composingEnter, 'isComposing', { value: true })
      textarea.dispatchEvent(composingEnter)
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', shiftKey: true }))
      textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }))
    })

    expect(onEnterPress).toHaveBeenCalledTimes(1)
    expect(onPressEnter).toHaveBeenCalledTimes(1)
  })
})
