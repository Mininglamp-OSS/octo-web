import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Drawer from './index'

vi.mock('@douyinfe/semi-icons', () => ({
  IconClose: ({ size }: { size?: string }) => <span data-icon="close" data-size={size} />,
}))

vi.mock('@douyinfe/semi-ui/lib/es/sideSheet', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const SideSheet = React.forwardRef<HTMLDivElement, any>(function MockSideSheet(
    {
      afterVisibleChange,
      bodyStyle,
      children,
      className,
      dialogClassName,
      height,
      mask,
      placement,
      size,
      visible,
      width,
      disableScroll,
      ...rest
    },
    ref,
  ) {
    afterVisibleChange?.(visible)
    return (
      <aside
        {...rest}
        ref={ref}
        className={className}
        data-body-display={bodyStyle?.display}
        data-dialog-class={dialogClassName}
        data-height={height}
        data-disable-scroll={String(disableScroll)}
        data-mask={String(mask)}
        data-placement={placement}
        data-size={size}
        data-visible={String(visible)}
        data-width={width}
      >
        {children}
      </aside>
    )
  })

  return { default: SideSheet }
})

describe('Drawer', () => {
  it('renders the default right drawer without mask', () => {
    const html = renderToStaticMarkup(
      <Drawer open title="聊天信息">
        <div>content</div>
      </Drawer>,
    )

    expect(html).toContain('octo-ui-drawer')
    expect(html).toContain('octo-ui-drawer--right')
    expect(html).toContain('octo-ui-drawer__dialog')
    expect(html).toContain('data-visible="true"')
    expect(html).toContain('data-mask="false"')
    expect(html).toContain('data-width="480"')
    expect(html).toContain('聊天信息')
  })

  it('maps size tokens to drawer width and Semi size', () => {
    const compact = renderToStaticMarkup(<Drawer open size="compact" title="Info" />)
    const wide = renderToStaticMarkup(<Drawer open size="wide" title="Full" />)

    expect(compact).toContain('data-width="336"')
    expect(compact).toContain('data-size="small"')
    expect(wide).toContain('data-width="664"')
    expect(wide).toContain('data-size="large"')
  })

  it('supports explicit width, footer, extra actions, and flush body', () => {
    const html = renderToStaticMarkup(
      <Drawer
        open
        bodyFlush
        contentClassName="drawer-content"
        extra={<button type="button">More</button>}
        footer={<span className="octo-ui-drawer__footer-placeholder">回复...</span>}
        title="Thread"
        width="min(50vw, 520px)"
      >
        <div>message stream</div>
      </Drawer>,
    )

    expect(html).toContain('data-width="min(50vw, 520px)"')
    expect(html).toContain('class="octo-ui-drawer__surface drawer-content"')
    expect(html).toContain('octo-ui-drawer__body--flush')
    expect(html).toContain('octo-ui-drawer__footer')
    expect(html).toContain('More')
  })

  it('keeps Semi-compatible visible alias during migration', () => {
    const html = renderToStaticMarkup(<Drawer visible={false} title="Legacy" />)

    expect(html).toContain('data-visible="false"')
  })

  it('does not lock page scroll by default but allows opt-in', () => {
    const defaultDrawer = renderToStaticMarkup(<Drawer open title="Default scroll" />)
    const blockingDrawer = renderToStaticMarkup(<Drawer open disableScroll title="Blocking scroll" />)

    expect(defaultDrawer).toContain('data-disable-scroll="false"')
    expect(blockingDrawer).toContain('data-disable-scroll="true"')
  })

  it('renders left placement with custom height for horizontal placements', () => {
    const left = renderToStaticMarkup(<Drawer open placement="left" title="Left" />)
    const top = renderToStaticMarkup(<Drawer open placement="top" height={320} title="Top" />)

    expect(left).toContain('octo-ui-drawer--left')
    expect(left).toContain('data-width="480"')
    expect(top).toContain('octo-ui-drawer--top')
    expect(top).toContain('data-height="320"')
  })

  it('supports inline layout without Semi portal chrome', () => {
    const html = renderToStaticMarkup(
      <Drawer inline open title="Inline" width={360}>
        body
      </Drawer>,
    )

    expect(html).toContain('octo-ui-drawer--inline')
    expect(html).toContain('data-octo-drawer-open="true"')
    expect(html).toContain('data-octo-drawer-motion="true"')
    expect(html).toContain('width:360px')
    expect(html).toContain('Inline')
  })

  it('honors disabled motion in inline layout', () => {
    const html = renderToStaticMarkup(
      <Drawer inline open motion={false} title="Inline">
        body
      </Drawer>,
    )

    expect(html).toContain('data-octo-drawer-motion="false"')
  })

  it('keeps closed inline content mounted when requested', () => {
    const html = renderToStaticMarkup(
      <Drawer inline keepDOM open={false} title="Inline hidden">
        hidden body
      </Drawer>,
    )

    expect(html).toContain('octo-ui-drawer--inline')
    expect(html).toContain('data-octo-drawer-open="false"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('inert=""')
    expect(html).toContain('hidden body')
  })
})
