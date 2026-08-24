// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Drawer from './index'

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
  document.body.innerHTML = ''
})

describe('Drawer with real Semi SideSheet', () => {
  it('renders into a custom portal container and calls close handlers', () => {
    const portal = document.createElement('div')
    document.body.appendChild(portal)
    const onClose = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <Drawer
        open
        motion={false}
        portalContainer={() => portal}
        title="聊天信息"
        onClose={onClose}
        onOpenChange={onOpenChange}
      >
        <div>content</div>
      </Drawer>,
    )

    expect(portal.querySelector('.octo-ui-drawer')).not.toBeNull()
    expect(portal.querySelector('.octo-ui-drawer__title')?.textContent).toBe('聊天信息')

    act(() => {
      portal.querySelector<HTMLButtonElement>('.octo-ui-drawer__close')?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not render a mask by default', () => {
    const portal = document.createElement('div')
    document.body.appendChild(portal)

    render(
      <Drawer open motion={false} portalContainer={() => portal} title="No mask">
        body
      </Drawer>,
    )

    expect(portal.querySelector('.semi-sidesheet-mask')).toBeNull()
  })
})
