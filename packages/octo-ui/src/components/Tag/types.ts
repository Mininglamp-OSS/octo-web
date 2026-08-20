import type { HTMLAttributes, ReactNode } from 'react'

export type TagVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
export type TagSize = 'sm' | 'md'

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant
  size?: TagSize
  icon?: ReactNode
  children?: ReactNode
}
