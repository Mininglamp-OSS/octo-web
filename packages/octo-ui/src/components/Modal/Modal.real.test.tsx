// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Modal from './index'

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

describe('Modal with real Semi Modal', () => {
  it('renders into a custom portal container and calls close handlers', () => {
    const portal = document.createElement('div')
    document.body.appendChild(portal)
    const onClose = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <Modal
        open
        motion={false}
        portalContainer={() => portal}
        title="创建Space："
        onClose={onClose}
        onOpenChange={onOpenChange}
      >
        <div>content</div>
      </Modal>,
    )

    expect(portal.querySelector('.octo-ui-modal')).not.toBeNull()
    expect(portal.querySelector('.octo-ui-modal__title')?.textContent).toBe('创建Space：')

    act(() => {
      portal.querySelector<HTMLButtonElement>('.octo-ui-modal__close')?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders a mask and locks body scroll by default', () => {
    render(
      <Modal open motion={false} title="Blocking">
        body
      </Modal>,
    )

    expect(document.querySelector('.semi-modal-mask')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('does not render a mask when disabled', () => {
    render(
      <Modal open mask={false} motion={false} title="No mask">
        body
      </Modal>,
    )

    expect(document.querySelector('.semi-modal-mask')).toBeNull()
  })

  it('keeps a close button when a custom header is supplied', () => {
    render(
      <Modal open motion={false} header={<div className="custom-header">Custom header</div>} title="Custom dialog">
        body
      </Modal>,
    )

    expect(document.querySelector('.custom-header')?.textContent).toBe('Custom header')
    expect(document.querySelector<HTMLButtonElement>('.octo-ui-modal__close')?.getAttribute('aria-label')).toBe('Close')
  })

  it('labels the dialog with the Octo title node', () => {
    render(
      <Modal open motion={false} title="Named dialog">
        body
      </Modal>,
    )

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const labelledBy = dialog?.getAttribute('aria-labelledby')
    expect(labelledBy).toMatch(/^octo-ui-modal-title-/)
    expect(labelledBy).not.toBe('semi-modal-title')
    expect(document.getElementById(labelledBy ?? '')?.textContent).toBe('Named dialog')
  })
})
