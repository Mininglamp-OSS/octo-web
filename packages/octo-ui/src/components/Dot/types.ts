import type { HTMLAttributes } from 'react'

export type DotSize = 'default' | 'small'
export type DotTone = 'neutral' | 'danger' | 'success' | 'warning' | 'info'

export interface DotProps extends HTMLAttributes<HTMLSpanElement> {
  size?: DotSize
  tone?: DotTone
}
