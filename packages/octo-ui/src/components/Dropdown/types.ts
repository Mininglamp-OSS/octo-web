import type { CSSProperties, HTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react'
import type { MenuItemProps } from '../MenuItem/types'

export type DropdownTrigger = 'hover' | 'focus' | 'click' | 'custom' | 'contextMenu'

export type DropdownPosition =
  | 'top'
  | 'topLeft'
  | 'topRight'
  | 'left'
  | 'leftTop'
  | 'leftBottom'
  | 'right'
  | 'rightTop'
  | 'rightBottom'
  | 'bottom'
  | 'bottomLeft'
  | 'bottomRight'

export type DropdownItemKey = string | number

export interface DropdownItemConfig {
  key: DropdownItemKey
  label: ReactNode
  icon?: ReactNode
  shortcut?: ReactNode
  suffix?: ReactNode
  selected?: boolean
  active?: boolean
  disabled?: boolean
  danger?: boolean
  type?: 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger'
  className?: string
  style?: CSSProperties
  closeOnSelect?: boolean
  'data-testid'?: string
}

export interface DropdownProps {
  children: ReactElement
  overlay?: ReactNode
  render?: ReactNode
  items?: DropdownItemConfig[]
  trigger?: DropdownTrigger
  position?: DropdownPosition
  visible?: boolean
  onVisibleChange?: (visible: boolean) => void
  onAction?: (key: DropdownItemKey, event: MouseEvent<HTMLButtonElement>) => void
  closeOnSelect?: boolean
  renderInPortal?: boolean
  getPopupContainer?: () => HTMLElement
  spacing?: number | { x: number; y: number }
  zIndex?: number
  className?: string
  contentClassName?: string
  overlayClassName?: string
  style?: CSSProperties
  overlayStyle?: CSSProperties
  width?: CSSProperties['width']
  minWidth?: CSSProperties['minWidth']
  disabled?: boolean
  motion?: boolean
  rePosKey?: string | number
  closeOnEsc?: boolean
}

export interface DropdownMenuProps extends Omit<HTMLAttributes<HTMLUListElement>, 'children'> {
  children?: ReactNode
  width?: number | string
  maxHeight?: number | string
}

export interface DropdownItemProps extends Omit<MenuItemProps, 'onClick' | 'label' | 'type'> {
  itemKey?: DropdownItemKey
  label?: ReactNode
  active?: boolean
  type?: DropdownItemConfig['type']
  shellClassName?: string
  shellProps?: HTMLAttributes<HTMLLIElement>
  submenu?: ReactNode
  closeOnSelect?: boolean
  onSelect?: (event: MouseEvent<HTMLButtonElement>) => void
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

export interface DropdownDividerProps {
  className?: string
  style?: CSSProperties
}
