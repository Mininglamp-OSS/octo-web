import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Tag } from './index'

const findCloseButton = (html: string) => html.includes('class="octo-ui-tag__close"')

describe('Tag', () => {
  it('renders children and default new palette classes', () => {
    const html = renderToStaticMarkup(<Tag>Ready</Tag>)

    expect(html).toContain('octo-ui-tag')
    expect(html).toContain('octo-ui-tag--light')
    expect(html).toContain('octo-ui-tag--gray')
    expect(html).toContain('octo-ui-tag--default')
    expect(html).toContain('Ready')
  })

  it('supports variant, tone, size, and custom className', () => {
    const html = renderToStaticMarkup(
      <Tag variant="solid" tone="teal" size="small" className="custom-tag">
        Synced
      </Tag>,
    )

    expect(html).toContain('octo-ui-tag--solid')
    expect(html).toContain('octo-ui-tag--teal')
    expect(html).toContain('octo-ui-tag--small')
    expect(html).toContain('custom-tag')
  })

  it('supports the extra-small size from the component specification', () => {
    const html = renderToStaticMarkup(<Tag size="xs">External</Tag>)

    expect(html).toContain('octo-ui-tag--xs')
  })

  it('supports the AI gradient palette', () => {
    const html = renderToStaticMarkup(<Tag variant="ai">AI collaboration</Tag>)

    expect(html).toContain('octo-ui-tag--ai')
  })

  it('renders an optional icon', () => {
    const html = renderToStaticMarkup(
      <Tag icon={<span data-icon="status">i</span>}>Info</Tag>,
    )

    expect(html).toContain('octo-ui-tag__icon')
    expect(html).toContain('data-icon="status"')
    expect(html).toContain('Info')
  })

  it('renders close button when closable', () => {
    const html = renderToStaticMarkup(<Tag closable closeAriaLabel="Remove tag">Removable</Tag>)

    expect(findCloseButton(html)).toBe(true)
    expect(html).toContain('aria-label="Remove tag"')
  })

  it('uses custom close aria label', () => {
    const html = renderToStaticMarkup(<Tag closable closeAriaLabel="删除状态标签">Removable</Tag>)

    expect(html).toContain('aria-label="删除状态标签"')
  })

  it('keeps the close button accessible', () => {
    const html = renderToStaticMarkup(<Tag closable closeAriaLabel="关闭标签">Removable</Tag>)

    expect(html).toContain('type="button"')
    expect(html).toContain('aria-label="关闭标签"')
    expect(html).toContain('focusable="false"')
  })

  it('maps legacy variants and sizes without exposing legacy classes', () => {
    const html = renderToStaticMarkup(<Tag variant="brand" size="sm">Legacy brand</Tag>)

    expect(html).toContain('octo-ui-tag--light')
    expect(html).toContain('octo-ui-tag--purple')
    expect(html).toContain('octo-ui-tag--small')
    expect(html).not.toContain('octo-ui-tag--brand')
  })
})
