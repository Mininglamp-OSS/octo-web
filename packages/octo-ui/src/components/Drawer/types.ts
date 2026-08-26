import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react'

export type DrawerPlacement = 'top' | 'right' | 'bottom' | 'left'
export type DrawerSize = 'compact' | 'default' | 'wide'

export interface DrawerProps {
  'aria-label'?: string
  afterClose?: () => void
  afterOpenChange?: (open: boolean) => void
  bodyClassName?: string
  bodyFlush?: boolean
  children?: ReactNode
  className?: string
  closable?: boolean
  closeIcon?: ReactNode
  closeOnEsc?: boolean
  closeLabel?: string
  contentClassName?: string
  defaultOpen?: boolean
  /** @deprecated Use defaultOpen. */
  defaultVisible?: boolean
  disableScroll?: boolean
  extra?: ReactNode
  footer?: ReactNode
  footerClassName?: string
  height?: CSSProperties['height']
  /**
   * Render the drawer inside the current React tree instead of Semi's portal.
   * Use this for app-owned right panels that live inside a positioned layout container.
   */
  inline?: boolean
  keepDOM?: boolean
  mask?: boolean
  maskClosable?: boolean
  maskStyle?: CSSProperties
  motion?: boolean
  onClose?: (event?: MouseEvent<Element> | KeyboardEvent<Element>) => void
  /** @deprecated Use onClose. */
  onCancel?: (event?: MouseEvent<Element> | KeyboardEvent<Element>) => void
  onOpenChange?: (open: boolean) => void
  /** @deprecated Use onOpenChange. */
  onVisibleChange?: (visible: boolean) => void
  open?: boolean
  placement?: DrawerPlacement
  portalContainer?: () => HTMLElement
  size?: DrawerSize
  style?: CSSProperties
  title?: ReactNode
  /** @deprecated Use open. */
  visible?: boolean
  width?: CSSProperties['width']
  zIndex?: number
}
