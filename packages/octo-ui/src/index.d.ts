import type { FC, ReactNode } from 'react'

import type { ButtonProps } from './components/Button/types'
import type { TagProps } from './components/Tag/types'

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
export interface OctoUIProviderProps {
  children?: ReactNode
}

export declare const Button: FC<ButtonProps>
export declare const Tag: FC<TagProps>
export declare const OctoUIProvider: FC<OctoUIProviderProps>
