import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MenuItem } from './index'

describe('MenuItem', () => {
  it('renders label, icon, shortcut, and default classes', () => {
    const html = renderToStaticMarkup(
      <MenuItem icon={<span data-icon="plus" />} label="Create" shortcut="⌘N" />,
    )

    expect(html).toContain('octo-ui-menu-item')
    expect(html).toContain('octo-ui-menu-item--default')
    expect(html).toContain('data-icon="plus"')
    expect(html).toContain('Create')
    expect(html).toContain('⌘N')
    expect(html).not.toContain('role=')
    expect(html).toContain('type="button"')
  })

  it('allows consumers to opt into menu roles without emitting invalid selected aria', () => {
    const html = renderToStaticMarkup(
      <MenuItem label="Create" role="menuitem" selected />,
    )

    expect(html).toContain('role="menuitem"')
    expect(html).toContain('octo-ui-menu-item--selected')
    expect(html).not.toContain('aria-selected')
  })

  it('supports selected, danger, disabled, compact, suffix, and custom className', () => {
    const html = renderToStaticMarkup(
      <MenuItem
        className="custom-menu-item"
        danger
        disabled
        selected
        size="compact"
        suffix={<span data-suffix="arrow" />}
      >
        Delete
      </MenuItem>,
    )

    expect(html).toContain('octo-ui-menu-item--selected')
    expect(html).toContain('octo-ui-menu-item--danger')
    expect(html).toContain('octo-ui-menu-item--compact')
    expect(html).toContain('custom-menu-item')
    expect(html).toContain('disabled')
    expect(html).toContain('data-suffix="arrow"')
  })
})
