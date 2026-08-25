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
        contentClassName="drawer-real-content"
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
    expect(portal.querySelector('.octo-ui-drawer__surface.drawer-real-content')).not.toBeNull()
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

  it('does not lock body scroll by default', () => {
    render(
      <Drawer open motion={false} title="Non blocking">
        body
      </Drawer>,
    )

    expect(document.body.style.overflow).toBe('')
  })

  it('locks body scroll by default when masked', () => {
    render(
      <Drawer open mask motion={false} title="Blocking">
        body
      </Drawer>,
    )

    expect(document.body.style.overflow).toBe('hidden')
  })

  it('does not report a close during the first closed inline render', () => {
    const afterClose = vi.fn()
    const afterOpenChange = vi.fn()

    render(
      <Drawer inline keepDOM open={false} title="Inline" afterClose={afterClose} afterOpenChange={afterOpenChange}>
        body
      </Drawer>,
    )

    expect(afterClose).not.toHaveBeenCalled()
    expect(afterOpenChange).not.toHaveBeenCalled()
  })

  it('closes inline drawers on Escape without passing a synthetic event impostor', () => {
    const onClose = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <Drawer inline open title="Inline" onClose={onClose} onOpenChange={onOpenChange}>
        body
      </Drawer>,
    )

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(onClose).toHaveBeenCalledWith(undefined)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
