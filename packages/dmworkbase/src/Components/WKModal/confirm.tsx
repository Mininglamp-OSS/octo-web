import React from 'react'
import { Modal } from '@douyinfe/semi-ui'
import type { ConfirmProps, ModalReactProps } from '@douyinfe/semi-ui/modal'
import { t } from '../../i18n'
import WKButton from '../WKButton'

type WKConfirmPending = 'ok' | 'cancel' | null

export type WKConfirmProps = Omit<
  ModalReactProps,
  | 'cancelButtonProps'
  | 'cancelLoading'
  | 'className'
  | 'confirmLoading'
  | 'footer'
  | 'hasCancel'
  | 'icon'
  | 'okButtonProps'
> & {
  className?: string
}

export function wkConfirm(props: WKConfirmProps) {
  const { className, okText, cancelText, okType, onOk, onCancel, ...rest } = props
  const resolvedOkText = okText ?? t('base.common.ok')
  const resolvedCancelText = cancelText ?? t('base.common.cancel')
  let modalRef: ReturnType<typeof Modal.confirm>

  const renderContent = (pending: WKConfirmPending = null) => {
    const updatePending = (nextPending: WKConfirmPending) => {
      const updateConfig: ConfirmProps = {
        type: 'confirm',
        content: renderContent(nextPending),
      }
      modalRef?.update(updateConfig)
    }

    const runAction = (action: 'ok' | 'cancel', event: React.MouseEvent<HTMLButtonElement>) => {
      if (pending) return
      const callback = action === 'ok' ? onOk : onCancel
      const result = callback?.(event)

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        updatePending(action)
        void (result as Promise<unknown>)
          .then(() => modalRef?.destroy())
          .catch(() => updatePending(null))
        return
      }

      modalRef?.destroy()
    }

    return (
      <div className="wk-modal-confirm-shell">
        {props.title !== null && props.title !== undefined && (
          <div className="wk-modal-title wk-modal-confirm-title">{props.title}</div>
        )}
        <div className="wk-modal-confirm-body">
          {typeof props.content === 'string' ? (
            <p className="wk-modal-confirm-text">{props.content}</p>
          ) : (
            props.content
          )}
        </div>
        <div className="wk-modal-footer wk-modal-confirm-footer">
          <WKButton
            variant="secondary"
            disabled={pending !== null}
            loading={pending === 'cancel'}
            onClick={(event) => runAction('cancel', event)}
          >
            {resolvedCancelText}
          </WKButton>
          <WKButton
            variant={okType === 'danger' ? 'danger' : 'primary'}
            disabled={pending !== null}
            loading={pending === 'ok'}
            onClick={(event) => runAction('ok', event)}
          >
            {resolvedOkText}
          </WKButton>
        </div>
      </div>
    )
  }

  modalRef = Modal.confirm({
    ...rest,
    icon: null,
    className: ['wk-modal', 'wk-modal-confirm', className].filter(Boolean).join(' '),
    modalContentClass: 'wk-modal-content',
    title: null,
    header: null,
    footer: null,
    onCancel,
    content: renderContent(),
  })

  return modalRef
}
