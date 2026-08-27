import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'

export type ModalSize = 'default' | 'wide' | 'fullscreen'
export type ModalTone = 'default' | 'danger' | 'warning' | 'info' | 'success'

export interface ModalFooterConfig {
  cancelText?: string
  okText?: string
  isCancelDisabled?: boolean
  isOkDisabled?: boolean
  isOkLoading?: boolean
  isDanger?: boolean
  onCancel?: () => void | Promise<void>
  onOk?: () => void | Promise<void>
}

export interface ModalProps {
  'aria-label'?: string
  afterClose?: () => void
  bodyClassName?: string
  bodyStyle?: CSSProperties
  children?: ReactNode
  className?: string
  closable?: boolean
  closeClassName?: string
  closeIcon?: ReactNode
  closeLabel?: string
  closeOnEsc?: boolean
  contentClassName?: string
  defaultOpen?: boolean
  /** @deprecated Use defaultOpen. */
  defaultVisible?: boolean
  footer?: ReactNode
  footerClassName?: string
  footerConfig?: ModalFooterConfig
  header?: ReactNode
  headerClassName?: string
  keepDOM?: boolean
  mask?: boolean
  maskClosable?: boolean
  maskStyle?: CSSProperties
  modalContentClassName?: string
  motion?: boolean
  onClose?: (event?: MouseEvent<Element> | KeyboardEvent<Element>) => void
  /** @deprecated Use onClose. */
  onCancel?: (event?: MouseEvent<Element> | KeyboardEvent<Element>) => void
  onOpenChange?: (open: boolean) => void
  /** @deprecated Pass closable, mask, maskClosable, and closeOnEsc directly. */
  options?: {
    closable?: boolean
    closeOnEsc?: boolean
    mask?: boolean
    maskClosable?: boolean
  }
  /** @deprecated Use onOpenChange. */
  onVisibleChange?: (visible: boolean) => void
  open?: boolean
  portalContainer?: () => HTMLElement
  size?: ModalSize
  style?: CSSProperties
  title?: ReactNode
  titleClassName?: string
  /** @deprecated Use open. */
  visible?: boolean
  width?: CSSProperties['width']
  zIndex?: number
}

export interface ConfirmModalProps extends Omit<ModalProps, 'bodyClassName' | 'children' | 'contentClassName' | 'footer' | 'footerConfig' | 'size'> {
  cancelText?: string
  confirmLoading?: boolean
  content?: ReactNode
  description?: ReactNode
  hasCancel?: boolean
  icon?: ReactNode
  okText?: string
  okType?: 'default' | 'danger'
  onOk?: () => void | Promise<void>
  tone?: ModalTone
}

export interface ModalConfirmHandle {
  destroy: () => void
  update: (config: Partial<ModalConfirmOptions>) => void
}

export interface ModalConfirmOptions {
  cancelText?: string
  className?: string
  closeOnEsc?: boolean
  content?: ReactNode
  mask?: boolean
  maskClosable?: boolean
  modalContentClassName?: string
  okText?: string
  okType?: 'default' | 'danger'
  onCancel?: (event?: MouseEvent<Element>) => void | Promise<void>
  onOk?: (event?: MouseEvent<Element>) => void | Promise<void>
  style?: CSSProperties
  title?: ReactNode
  width?: CSSProperties['width']
  zIndex?: number
}
