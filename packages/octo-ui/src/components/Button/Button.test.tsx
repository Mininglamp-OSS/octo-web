import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from './index'

describe('Button', () => {
  it('renders children and default classes', () => {
    const html = renderToStaticMarkup(<Button>Confirm</Button>)

    expect(html).toContain('octo-ui-button')
    expect(html).toContain('octo-ui-button--secondary')
    expect(html).toContain('octo-ui-button--md')
    expect(html).toContain('Confirm')
    expect(html).toContain('type="button"')
  })

  it('supports variant, size, and custom className', () => {
    const html = renderToStaticMarkup(
      <Button variant="primary" size="sm" className="custom-button">
        Save
      </Button>,
    )

    expect(html).toContain('octo-ui-button--primary')
    expect(html).toContain('octo-ui-button--sm')
    expect(html).toContain('custom-button')
  })

  it('disables the button and renders a spinner while loading', () => {
    const html = renderToStaticMarkup(<Button loading>Save</Button>)

    expect(html).toContain('disabled')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('octo-ui-button--loading')
    expect(html).toContain('octo-ui-button__spinner')
  })

  it('renders icon-only buttons without the text label', () => {
    const html = renderToStaticMarkup(
      <Button iconOnly icon={<span data-icon="close">x</span>} aria-label="Close">
        Close
      </Button>,
    )

    expect(html).toContain('octo-ui-button--icon-only')
    expect(html).toContain('data-icon="close"')
    expect(html).not.toContain('octo-ui-button__label')
  })
})
