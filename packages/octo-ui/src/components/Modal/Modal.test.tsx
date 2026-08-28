import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import Modal, { ConfirmModal, confirm } from './index'

vi.mock('@douyinfe/semi-icons', () => ({
  IconAlertTriangle: () => <span data-icon="alert-triangle" />,
  IconClose: ({ size }: { size?: string }) => <span data-icon="close" data-size={size} />,
  IconInfoCircle: () => <span data-icon="info" />,
  IconTickCircle: () => <span data-icon="success" />,
}))

const { confirmMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
}))

vi.mock('@douyinfe/semi-ui/lib/es/modal', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  const Modal = React.forwardRef<HTMLDivElement, any>(function MockModal(
    {
      afterClose,
      bodyStyle,
      children,
      className,
      getPopupContainer,
      mask,
      maskClosable,
      modalRender,
      modalContentClass,
      visible,
      width,
      ...rest
    },
    ref,
  ) {
    if (!visible) afterClose?.()
    const content = (
      <section
        {...rest}
        ref={ref}
        className={className}
        data-body-padding={bodyStyle?.padding}
        data-has-portal={String(Boolean(getPopupContainer))}
        data-mask={String(mask)}
        data-mask-closable={String(maskClosable)}
        data-modal-content-class={modalContentClass}
        data-visible={String(visible)}
        data-width={width}
      >
        <div className={modalContentClass}>{children}</div>
      </section>
    )
    return modalRender ? modalRender(content) : content
  })
  ;(Modal as any).confirm = confirmMock

  return { default: Modal }
})

describe('Modal', () => {
  it('renders the default modal shell and maps props to Semi', () => {
    const html = renderToStaticMarkup(
      <Modal open title="创建Space：" portalContainer={() => document.body}>
        <div>content</div>
      </Modal>,
    )

    expect(html).toContain('octo-ui-modal')
    expect(html).toContain('octo-ui-modal__content')
    expect(html).toContain('octo-ui-modal__surface')
    expect(html).toContain('data-visible="true"')
    expect(html).toContain('data-mask="true"')
    expect(html).toContain('data-mask-closable="true"')
    expect(html).toContain('data-width="480"')
    expect(html).toContain('data-has-portal="true"')
    expect(html).toContain('创建Space：')
    expect(html).toContain('content')
  })

  it('supports visible alias, explicit width, and custom footer', () => {
    const html = renderToStaticMarkup(
      <Modal
        visible
        footer={<button type="button">Apply</button>}
        title="Settings"
        width="min(80vw, 680px)"
      >
        body
      </Modal>,
    )

    expect(html).toContain('data-visible="true"')
    expect(html).toContain('data-width="min(80vw, 680px)"')
    expect(html).toContain('octo-ui-modal__footer')
    expect(html).toContain('Apply')
  })

  it('renders footer config buttons with danger state', () => {
    const html = renderToStaticMarkup(
      <Modal
        open
        footerConfig={{ cancelText: '取消', isDanger: true, okText: '删除', onOk: vi.fn() }}
        title="Delete"
      />,
    )

    expect(html).toContain('取消')
    expect(html).toContain('删除')
    expect(html).toContain('octo-ui-button--danger')
  })

  it('allows extending the Semi content class for compatibility adapters', () => {
    const html = renderToStaticMarkup(
      <Modal open modalContentClassName="octo-ui-modal__content" title="Compat" />,
    )

    expect(html).toContain('data-modal-content-class="octo-ui-modal__content octo-ui-modal__content"')
  })

  it('supports close and title slot classes for legacy adapters', () => {
    const html = renderToStaticMarkup(
      <Modal open closeClassName="octo-ui-modal__close--legacy-hitarea legacy-close" title="Compat" titleClassName="legacy-title" />,
    )

    expect(html).toContain('class="octo-ui-modal__title legacy-title"')
    expect(html).toContain('class="octo-ui-modal__close octo-ui-modal__close--legacy-hitarea legacy-close"')
  })

  it('supports custom header slot and header class', () => {
    const html = renderToStaticMarkup(
      <Modal open header={<div className="custom-header">Custom</div>} headerClassName="unused-header" title="Compat" />,
    )

    expect(html).toContain('custom-header')
    expect(html).not.toContain('octo-ui-modal__header unused-header')
    expect(html).toContain('aria-label="Close"')
  })

  it('can hide the header and footer', () => {
    const html = renderToStaticMarkup(
      <Modal open closable={false} footer={null}>
        Plain
      </Modal>,
    )

    expect(html).not.toContain('octo-ui-modal__header')
    expect(html).not.toContain('octo-ui-modal__close')
    expect(html).not.toContain('octo-ui-modal__footer')
    expect(html).toContain('Plain')
  })

  it('maps Octo title semantics onto the dialog element', () => {
    const html = renderToStaticMarkup(
      <Modal open title="Settings">
        body
      </Modal>,
    )

    expect(html).toContain('aria-labelledby="octo-ui-modal-title-')
    expect(html).not.toContain('aria-labelledby="semi-modal-title"')
  })
})

describe('confirm', () => {
  it('renders a command confirm through Semi with Octo UI classes', () => {
    const handle = { destroy: vi.fn(), update: vi.fn() }
    confirmMock.mockReturnValueOnce(handle)

    const result = confirm({
      content: '删除后无法恢复',
      okText: '删除',
      okType: 'danger',
      title: '确认删除？',
    })

    expect(result).toBe(handle)
    expect(confirmMock).toHaveBeenCalledTimes(1)
    const config = confirmMock.mock.calls[0][0]
    expect(config.className).toContain('octo-ui-modal')
    expect(config.modalContentClass).toBe('octo-ui-modal__content')
    expect(config.title).toBeNull()
    expect(config.footer).toBeNull()

    const html = renderToStaticMarkup(config.content)
    expect(html).toContain('确认删除？')
    expect(html).toContain('删除后无法恢复')
    expect(html).toContain('octo-ui-button--danger')
  })
})

describe('ConfirmModal', () => {
  it('renders confirm content and danger action', () => {
    const html = renderToStaticMarkup(
      <ConfirmModal open okType="danger" title="确认删除？" description="删除后无法恢复" />,
    )

    expect(html).toContain('octo-ui-modal__surface--confirm')
    expect(html).toContain('octo-ui-modal-confirm__icon--danger')
    expect(html).toContain('class="octo-ui-modal-confirm__title">确认删除？</div>')
    expect(html).toContain('确认删除？')
    expect(html).toContain('删除后无法恢复')
    expect(html).toContain('octo-ui-button--danger')
  })
})
