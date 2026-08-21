import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type MenuItemSize = 'default' | 'compact'

export interface MenuItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: ReactNode
  label?: ReactNode
  shortcut?: ReactNode
  suffix?: ReactNode
  selected?: boolean
  danger?: boolean
  size?: MenuItemSize
  children?: ReactNode
}
