import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Tag } from './index'

describe('Tag', () => {
  it('renders children and default classes', () => {
    const html = renderToStaticMarkup(<Tag>Ready</Tag>)

    expect(html).toContain('octo-ui-tag')
    expect(html).toContain('octo-ui-tag--neutral')
    expect(html).toContain('octo-ui-tag--sm')
    expect(html).toContain('Ready')
  })

  it('supports variant, size, and custom className', () => {
    const html = renderToStaticMarkup(
      <Tag variant="success" size="md" className="custom-tag">
        Synced
      </Tag>,
    )

    expect(html).toContain('octo-ui-tag--success')
    expect(html).toContain('octo-ui-tag--md')
    expect(html).toContain('custom-tag')
  })

  it('renders an optional icon', () => {
    const html = renderToStaticMarkup(
      <Tag icon={<span data-icon="status">i</span>}>Info</Tag>,
    )

    expect(html).toContain('octo-ui-tag__icon')
    expect(html).toContain('data-icon="status"')
    expect(html).toContain('Info')
  })
})
