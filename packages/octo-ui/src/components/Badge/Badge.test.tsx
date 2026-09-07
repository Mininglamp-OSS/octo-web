import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Badge } from './index'

describe('Badge', () => {
  it('renders the default appearance and count', () => {
    const html = renderToStaticMarkup(<Badge count={12} />)

    expect(html).toContain('octo-ui-badge--strong')
    expect(html).toContain('octo-ui-badge--default')
    expect(html).toContain('>12<')
  })

  it('supports soft, small, custom class, and HTML attributes', () => {
    const html = renderToStaticMarkup(
      <Badge
        count={8}
        variant="soft"
        size="small"
        className="custom"
        aria-label="Unread messages"
      />,
    )

    expect(html).toContain('octo-ui-badge--soft')
    expect(html).toContain('octo-ui-badge--small')
    expect(html).toContain('custom')
    expect(html).toContain('aria-label="Unread messages"')
  })

  it('formats overflow counts and can show the full count', () => {
    expect(renderToStaticMarkup(<Badge count={100} />)).toContain('>99+<')
    expect(
      renderToStaticMarkup(<Badge count={128} overflowCount={null} />),
    ).toContain('>128<')
  })

  it('hides zero by default and can show it explicitly', () => {
    expect(renderToStaticMarkup(<Badge count={0} />)).toBe('')
    expect(renderToStaticMarkup(<Badge count={0} showZero />)).toContain('>0<')
  })

  it('supports short custom content and hides empty content', () => {
    expect(renderToStaticMarkup(<Badge>NEW</Badge>)).toContain('>NEW<')
    expect(renderToStaticMarkup(<Badge />)).toBe('')
  })
})
