import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Dropdown from './index'

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
})
