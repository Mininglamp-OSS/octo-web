import type { FC, ReactNode } from 'react'

import type { ButtonProps } from './components/Button/types'
import type { TagProps } from './components/Tag/types'
import type { BadgeProps } from './components/Badge/types'
import type { DotProps } from './components/Dot/types'

export type {
  ButtonProps,
  ButtonSize,
  ButtonVariant,
} from './components/Button/types'
export type {
  LegacyTagVariant,
  TagPaletteVariant,
  TagProps,
  TagSize,
  TagTone,
  TagVariant,
} from './components/Tag/types'
export type { BadgeProps, BadgeSize, BadgeVariant } from './components/Badge/types'
export type { DotProps, DotSize, DotTone } from './components/Dot/types'
export interface OctoUIProviderProps {
  children?: ReactNode
}

export declare const Button: FC<ButtonProps>
export declare const Tag: FC<TagProps>
export declare const Badge: FC<BadgeProps>
export declare const Dot: FC<DotProps>
export declare const OctoUIProvider: FC<OctoUIProviderProps>
