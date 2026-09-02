// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Button from './index'

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

describe('Button with real Semi Button', () => {
  it('keeps disabled on the native button', () => {
    render(<Button disabled>Disabled</Button>)

    expect(container?.querySelector('button')?.disabled).toBe(true)
  })

  it('forwards refs to the mounted native button', () => {
    const ref = React.createRef<HTMLButtonElement>()

    render(<Button ref={ref}>Focusable</Button>)

    expect(ref.current).toBe(container?.querySelector('button'))
  })

  it('marks loading buttons busy and blocks clicks', () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Loading</Button>)
    const button = container?.querySelector('button')

    expect(button?.disabled).toBe(true)
    expect(button?.getAttribute('aria-busy')).toBe('true')
    expect(button?.getAttribute('aria-disabled')).toBe('true')
    act(() => {
      button?.click()
    })
    expect(onClick).not.toHaveBeenCalled()
  })
})
