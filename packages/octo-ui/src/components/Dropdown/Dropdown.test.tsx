// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dropdown from './index'

vi.hoisted(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

vi.mock('@douyinfe/semi-ui', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Dropdown = ({
    children,
    className,
    contentClassName,
    render,
    trigger,
    position,
    visible,
  }: any) => (
    <div
      className={className}
      data-content-class={contentClassName}
      data-position={position}
      data-trigger={trigger}
      data-visible={String(Boolean(visible))}
    >
      {children}
      <div data-testid="mock-dropdown-render">{render}</div>
    </div>
  )

  return { Dropdown }
})

let container: HTMLDivElement | null = null
let mountedRoot: ReturnType<typeof createRoot> | null = null

function renderInDom(element: ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  mountedRoot = createRoot(container)
  act(() => {
    mountedRoot?.render(element)
  })
  return { container }
}

afterEach(() => {
  vi.useRealTimers()
  if (!container) return
  act(() => {
    mountedRoot?.unmount()
  })
  document.body.removeChild(container)
  container = null
  mountedRoot = null
})

describe('Dropdown', () => {
  it('renders overlay content with stable Octo classes', () => {
    const html = renderToStaticMarkup(
      <Dropdown
        trigger="click"
        position="bottomRight"
        overlay={
          <Dropdown.Menu>
            <Dropdown.Item active>Rename</Dropdown.Item>
            <Dropdown.Item danger disabled>Delete</Dropdown.Item>
            <Dropdown.Divider />
          </Dropdown.Menu>
        }
      >
        <button type="button">Open</button>
      </Dropdown>,
    )

    expect(html).toContain('octo-ui-dropdown-popover')
    expect(html).toContain('octo-ui-dropdown')
    expect(html).toContain('octo-ui-dropdown-menu')
    expect(html).toContain('octo-ui-dropdown-item-shell')
    expect(html).toContain('octo-ui-menu-item--selected')
    expect(html).toContain('octo-ui-dropdown-item--active')
    expect(html).toContain('octo-ui-menu-item--danger')
    expect(html).toContain('octo-ui-dropdown-divider')
    expect(html).toContain('data-trigger="click"')
    expect(html).toContain('data-position="bottomRight"')
  })

  it('renders item configs through MenuItem', () => {
    const html = renderToStaticMarkup(
      <Dropdown
        items={[
          { key: 'all', label: 'All', active: true },
          { key: 'delete', label: 'Delete', type: 'danger' },
        ]}
      >
        <button type="button">Status</button>
      </Dropdown>,
    )

    expect(html).toContain('All')
    expect(html).toContain('Delete')
    expect(html).toContain('octo-ui-menu-item--selected')
    expect(html).toContain('octo-ui-menu-item--danger')
  })

  it('keeps controlled visibility wired to Semi', () => {
    const html = renderToStaticMarkup(
      <Dropdown visible={false} overlay={<Dropdown.Menu />}>
        <button type="button">Open</button>
      </Dropdown>,
    )

    expect(html).toContain('data-visible="false"')
  })

  it('only enables menu scrolling when maxHeight is explicit', () => {
    const plainHtml = renderToStaticMarkup(<Dropdown.Menu><Dropdown.Item>One</Dropdown.Item></Dropdown.Menu>)
    const scrollHtml = renderToStaticMarkup(
      <Dropdown.Menu maxHeight={120}><Dropdown.Item>One</Dropdown.Item></Dropdown.Menu>,
    )

    expect(plainHtml).not.toContain('octo-ui-dropdown-menu--scrollable')
    expect(scrollHtml).toContain('octo-ui-dropdown-menu--scrollable')
    expect(scrollHtml).toContain('max-height:120px')
  })

  it('moves focus across enabled menu items with keyboard navigation', () => {
    const onSelect = vi.fn()
    const { container } = renderInDom(
      <Dropdown.Menu>
        <Dropdown.Item>First</Dropdown.Item>
        <Dropdown.Item disabled>Second</Dropdown.Item>
        <Dropdown.Item onSelect={onSelect}>Third</Dropdown.Item>
      </Dropdown.Menu>,
    )

    const items = Array.from(
      container.querySelectorAll<HTMLElement>('.octo-ui-dropdown-item-shell[aria-disabled="false"]'),
    )
    expect(items).toHaveLength(2)

    act(() => {
      items[0].focus()
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[1])

    act(() => {
      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(items[0])

    act(() => {
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
      items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('defers close-on-select until after the item handler', () => {
    vi.useFakeTimers()
    const onVisibleChange = vi.fn()
    const onSelect = vi.fn()

    const { container } = renderInDom(
      <Dropdown
        visible
        onVisibleChange={onVisibleChange}
        overlay={
          <Dropdown.Menu>
            <Dropdown.Item onSelect={onSelect}>Rename</Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <button type="button">Open</button>
      </Dropdown>,
    )

    const item = container.querySelector<HTMLButtonElement>('button[role="menuitem"]')
    expect(item).not.toBeNull()

    act(() => {
      item?.click()
    })
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onVisibleChange).not.toHaveBeenCalled()

    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(onVisibleChange).toHaveBeenCalledWith(false)
  })
})
