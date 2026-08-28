import SemiModal from '@douyinfe/semi-ui/lib/es/modal'
import { cloneElement, forwardRef, isValidElement, useCallback, useMemo, useState } from 'react'
import type { ComponentRef, KeyboardEvent, MouseEvent, ReactElement, ReactNode, Ref } from 'react'
import Button from '../Button'
import type {
  ConfirmModalProps,
  ModalConfirmHandle,
  ModalConfirmOptions,
  ModalFooterConfig,
  ModalProps,
  ModalSize,
  ModalTone,
} from './types'

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const widthBySize: Record<ModalSize, number | string> = {
  default: 480,
  wide: 720,
  fullscreen: '80%',
}

let modalTitleSeed = 0

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof (value as Promise<unknown>).then === 'function')
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

function StatusIcon({ tone }: { tone: ModalTone }) {
  if (tone === 'success') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    )
  }
  if (tone === 'info') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 10v7M12 7h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3 22 20H2L12 3Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="M12 9v5M12 17h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

interface ModalFooterProps {
  className?: string
  config: ModalFooterConfig
  onClose: () => void
}

function ModalFooter({ className, config, onClose }: ModalFooterProps) {
  const [pending, setPending] = useState<'ok' | 'cancel' | null>(null)

  const runAction = (action: 'ok' | 'cancel') => {
    if (pending) return
    const callback = action === 'ok' ? config.onOk : config.onCancel
    const result = callback?.()
    if (!isPromiseLike(result)) {
      if (action === 'cancel') onClose()
      return
    }

    setPending(action)
    void result
      .then(() => {
        if (action === 'cancel') onClose()
      })
      .catch(() => undefined)
      .finally(() => setPending(null))
  }

  return (
    <footer className={cx('octo-ui-modal__footer', className)}>
      <Button
        disabled={config.isCancelDisabled || pending !== null}
        loading={pending === 'cancel'}
        variant="secondary"
        onClick={() => runAction('cancel')}
      >
        {config.cancelText ?? 'Cancel'}
      </Button>
      <Button
        disabled={config.isOkDisabled || (pending !== null && pending !== 'ok')}
        loading={config.isOkLoading || pending === 'ok'}
        variant={config.isDanger ? 'danger' : 'solid'}
        onClick={() => runAction('ok')}
      >
        {config.okText ?? 'OK'}
      </Button>
    </footer>
  )
}

function toneIcon(tone: ModalTone) {
  return <StatusIcon tone={tone} />
}

const Modal = forwardRef<ComponentRef<typeof SemiModal>, ModalProps>(function Modal(
  {
    'aria-label': ariaLabel,
    afterClose,
    bodyClassName,
    bodyStyle,
    children,
    className,
    closable = true,
    closeClassName,
    closeIcon,
    closeLabel = '关闭',
    closeOnEsc = true,
    contentClassName,
    defaultOpen,
    defaultVisible,
    footer,
    footerClassName,
    footerConfig,
    header,
    headerClassName,
    keepDOM,
    mask = true,
    maskClosable = true,
    maskStyle,
    modalContentClassName,
    motion = true,
    onCancel,
    onClose,
    onOpenChange,
    onVisibleChange,
    open,
    options,
    portalContainer,
    size = 'default',
    style,
    title,
    titleClassName,
    visible,
    width,
    zIndex,
  },
  ref,
) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? defaultVisible ?? false)
  const controlledOpen = open ?? visible
  const actualOpen = controlledOpen ?? internalOpen
  const modalWidth = width ?? widthBySize[size]
  const actualClosable = options?.closable ?? closable
  const actualCloseOnEsc = options?.closeOnEsc ?? closeOnEsc
  const actualMask = options?.mask ?? mask
  const actualMaskClosable = options?.maskClosable ?? maskClosable
  const titleId = useMemo(() => `octo-ui-modal-title-${++modalTitleSeed}`, [])
  const hasDefaultTitleNode = header === undefined && title !== null && title !== undefined
  const dialogLabel = ariaLabel ?? (typeof title === 'string' ? title : 'modal')

  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
    onVisibleChange?.(nextOpen)
  }, [controlledOpen, onOpenChange, onVisibleChange])

  const handleClose = useCallback((event?: MouseEvent<Element> | KeyboardEvent<Element>) => {
    setOpen(false)
    onClose?.(event)
    onCancel?.(event)
  }, [onCancel, onClose, setOpen])

  const closeNode = actualClosable ? (
    <button
      aria-label={closeLabel}
      className={cx('octo-ui-modal__close', closeClassName)}
      type="button"
      onClick={handleClose}
    >
      {closeIcon ?? <CloseIcon />}
    </button>
  ) : null

  const defaultHeaderNode = useMemo(() => {
    if (!title) return null
    return (
      <header className={cx('octo-ui-modal__header', headerClassName)}>
        <div id={titleId} className={cx('octo-ui-modal__title', titleClassName)}>{title}</div>
      </header>
    )
  }, [headerClassName, title, titleClassName, titleId])

  const headerNode = header !== undefined ? header : defaultHeaderNode
  const renderDialog = useCallback((node: ReactNode) => {
    if (!isValidElement(node)) return node

    const ariaProps = hasDefaultTitleNode
      ? { 'aria-labelledby': titleId, 'aria-label': undefined }
      : { 'aria-labelledby': undefined, 'aria-label': dialogLabel }

    return cloneElement(node as ReactElement<Record<string, unknown>>, ariaProps)
  }, [dialogLabel, hasDefaultTitleNode, titleId])

  return (
    <SemiModal
      ref={ref as Ref<ComponentRef<typeof SemiModal>>}
      afterClose={afterClose}
      bodyStyle={{ padding: 0 }}
      centered
      className={cx('octo-ui-modal', `octo-ui-modal--${size}`, className)}
      closable={false}
      closeOnEsc={actualCloseOnEsc}
      footer={null}
      getPopupContainer={portalContainer}
      header={null}
      keepDOM={keepDOM}
      mask={actualMask}
      maskClosable={actualMaskClosable}
      maskStyle={maskStyle}
      modalContentClass={cx('octo-ui-modal__content', modalContentClassName)}
      modalRender={renderDialog}
      motion={motion}
      style={style}
      title={null}
      visible={actualOpen}
      width={modalWidth}
      zIndex={zIndex}
      onCancel={handleClose}
    >
      <div className={cx('octo-ui-modal__surface', contentClassName)}>
        {headerNode}
        {closeNode}
        <div className={cx('octo-ui-modal__body', bodyClassName)} style={bodyStyle}>
          {children}
        </div>
        {footer !== undefined ? (
          footer === null ? null : (
            <footer className={cx('octo-ui-modal__footer', footerClassName)}>
              {footer}
            </footer>
          )
        ) : footerConfig ? (
          <ModalFooter className={footerClassName} config={footerConfig} onClose={() => handleClose()} />
        ) : null}
      </div>
    </SemiModal>
  )
})

function createConfirmContent(
  options: ModalConfirmOptions,
  pending: 'ok' | 'cancel' | null,
  runAction: (action: 'ok' | 'cancel', event: MouseEvent<HTMLButtonElement>) => void,
) {
  const {
    cancelText = 'Cancel',
    content,
    okText = 'OK',
    okType = 'default',
    title,
  } = options

  return (
    <div className="octo-ui-modal__surface octo-ui-modal__surface--confirm">
      <div className="octo-ui-modal__body">
        <div className="octo-ui-modal-confirm">
          <span className={cx('octo-ui-modal-confirm__icon', `octo-ui-modal-confirm__icon--${okType === 'danger' ? 'danger' : 'warning'}`)}>
            {toneIcon(okType === 'danger' ? 'danger' : 'warning')}
          </span>
          <div className="octo-ui-modal-confirm__content">
            {title ? <div className="octo-ui-modal-confirm__title">{title}</div> : null}
            {content ? (
              <div className="octo-ui-modal-confirm__description">
                {content}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <footer className="octo-ui-modal__footer">
        <Button
          disabled={pending !== null}
          loading={pending === 'cancel'}
          variant="secondary"
          onClick={(event) => runAction('cancel', event)}
        >
          {cancelText}
        </Button>
        <Button
          disabled={pending !== null}
          loading={pending === 'ok'}
          variant={okType === 'danger' ? 'danger' : 'solid'}
          onClick={(event) => runAction('ok', event)}
        >
          {okText}
        </Button>
      </footer>
    </div>
  )
}

function confirm(options: ModalConfirmOptions): ModalConfirmHandle {
  const {
    className,
    closeOnEsc,
    mask,
    maskClosable,
    modalContentClassName,
    onCancel,
    onOk,
    style,
    width,
    zIndex,
  } = options
  let modalRef: ModalConfirmHandle | undefined

  const renderContent = (pending: 'ok' | 'cancel' | null = null): ReactNode => {
    const updatePending = (nextPending: 'ok' | 'cancel' | null) => {
      modalRef?.update({
        content: renderContent(nextPending),
      })
    }

    const runAction = (action: 'ok' | 'cancel', event: MouseEvent<HTMLButtonElement>) => {
      if (pending) return
      const callback = action === 'ok' ? onOk : onCancel
      const result = callback?.(event)

      if (isPromiseLike(result)) {
        updatePending(action)
        void result
          .then(() => modalRef?.destroy())
          .catch(() => updatePending(null))
        return
      }

      modalRef?.destroy()
    }

    return createConfirmContent(options, pending, runAction)
  }

  modalRef = SemiModal.confirm({
    className: cx('octo-ui-modal', 'octo-ui-modal--default', 'octo-ui-modal-confirm-dialog', className),
    closeOnEsc,
    content: renderContent(),
    footer: null,
    header: null,
    icon: null,
    mask,
    maskClosable,
    modalContentClass: cx('octo-ui-modal__content', modalContentClassName),
    style,
    title: null,
    width,
    zIndex,
    onCancel,
  }) as ModalConfirmHandle

  return modalRef
}

const ConfirmModal = forwardRef<ComponentRef<typeof SemiModal>, ConfirmModalProps>(function ConfirmModal(
  {
    cancelText = 'Cancel',
    confirmLoading,
    content,
    description,
    hasCancel = true,
    icon,
    okText = 'OK',
    okType = 'default',
    onOk,
    tone = okType === 'danger' ? 'danger' : 'warning',
    title,
    ...rest
  },
  ref,
) {
  const [pending, setPending] = useState(false)

  const handleOk = () => {
    if (pending) return
    const result = onOk?.()
    if (!isPromiseLike(result)) return
    setPending(true)
    void result
      .catch(() => undefined)
      .finally(() => setPending(false))
  }

  return (
    <Modal
      {...rest}
      ref={ref}
      contentClassName="octo-ui-modal__surface--confirm"
      footer={hasCancel ? undefined : (
        <>
          <Button
            loading={confirmLoading || pending}
            variant={okType === 'danger' ? 'danger' : 'solid'}
            onClick={handleOk}
          >
            {okText}
          </Button>
        </>
      )}
      footerConfig={hasCancel ? {
        cancelText,
        isDanger: okType === 'danger',
        isOkLoading: confirmLoading,
        okText,
        onOk,
      } : undefined}
      size="default"
      title={null}
    >
      <div className="octo-ui-modal-confirm">
        <span className={cx('octo-ui-modal-confirm__icon', `octo-ui-modal-confirm__icon--${tone}`)}>
          {icon ?? toneIcon(tone)}
        </span>
        <div className="octo-ui-modal-confirm__content">
          {title ? <div className="octo-ui-modal-confirm__title">{title}</div> : null}
          {description ?? content ? (
            <div className="octo-ui-modal-confirm__description">
              {description ?? content}
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  )
})

export default Modal
export { ConfirmModal, Modal, confirm }
