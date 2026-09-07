import type { HTMLAttributes, ReactNode } from 'react'

export type BadgeVariant = 'strong' | 'soft'
export type BadgeSize = 'default' | 'small'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  count?: number
  overflowCount?: number | null
  showZero?: boolean
  children?: ReactNode
}
