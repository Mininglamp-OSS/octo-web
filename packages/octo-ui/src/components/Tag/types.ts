import type { HTMLAttributes, MouseEvent, ReactNode } from 'react'

export type TagPaletteVariant = 'light' | 'solid' | 'pastel' | 'ai'
export type LegacyTagVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger'
export type TagVariant = TagPaletteVariant | LegacyTagVariant
export type TagSize = 'default' | 'small' | 'xs' | 'sm' | 'md'
export type TagTone =
  | 'gray'
  | 'red'
  | 'amber'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'purple'
  | 'orange'
  | 'pink'
  | 'dark'
  | 'teal'
  | 'indigo'
  | 'magenta'
  | 'sky'
  | 'yellow'
  | 'peach'

interface TagBaseProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant
  size?: TagSize
  tone?: TagTone
  icon?: ReactNode
  children?: ReactNode
}

interface ClosableTagProps {
  closable: true
  closeAriaLabel: string
  onClose?: (event: MouseEvent<HTMLButtonElement>) => void
}

interface StaticTagProps {
  closable?: false
  closeAriaLabel?: never
  onClose?: never
}

export type TagProps = TagBaseProps & (ClosableTagProps | StaticTagProps)
