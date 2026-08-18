import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dot } from './index'

describe('Dot', () => {
  it('renders the default size and tone as decorative', () => {
    const html = renderToStaticMarkup(<Dot />)

    expect(html).toContain('octo-ui-dot--default')
    expect(html).toContain('octo-ui-dot--neutral')
    expect(html).toContain('aria-hidden="true"')
  })

  it('supports size, tone, custom class, and HTML attributes', () => {
    const html = renderToStaticMarkup(
      <Dot size="small" tone="success" className="custom" data-state="ready" />,
    )

    expect(html).toContain('octo-ui-dot--small')
    expect(html).toContain('octo-ui-dot--success')
    expect(html).toContain('custom')
    expect(html).toContain('data-state="ready"')
  })

  it('is exposed to assistive technology when labelled', () => {
    const html = renderToStaticMarkup(
      <Dot tone="danger" aria-label="Disconnected" />,
    )

    expect(html).toContain('aria-label="Disconnected"')
    expect(html).toContain('role="img"')
    expect(html).not.toContain('aria-hidden')
  })

  it('recognizes aria-labelledby and preserves explicit accessibility props', () => {
    const labelled = renderToStaticMarkup(
      <Dot aria-labelledby="status-text" />,
    )
    expect(labelled).toContain('aria-labelledby="status-text"')
    expect(labelled).toContain('role="img"')
    expect(labelled).not.toContain('aria-hidden')

    const explicit = renderToStaticMarkup(
      <Dot role="presentation" aria-hidden={false} />,
    )
    expect(explicit).toContain('role="presentation"')
    expect(explicit).toContain('aria-hidden="false"')
  })
})
