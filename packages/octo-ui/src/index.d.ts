import type {
  FC,
  ForwardRefExoticComponent,
  ReactNode,
  RefAttributes,
} from 'react'

import type { ButtonProps } from './components/Button/types'
import type { TagProps } from './components/Tag/types'
import type { BadgeProps } from './components/Badge/types'
import type { DotProps } from './components/Dot/types'
import type { TooltipProps } from './components/Tooltip/types'
import type { TabsProps } from './components/Tabs/types'

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
export type {
  TooltipContent,
  TooltipContentConfig,
  TooltipLayout,
  TooltipPlacement,
  TooltipProps,
} from './components/Tooltip/types'
export type { TabItem, TabsProps, TabsSize, TabsVariant } from './components/Tabs/types'
export interface OctoUIProviderProps {
  children?: ReactNode
}

export declare const Button: ForwardRefExoticComponent<
  ButtonProps & RefAttributes<HTMLButtonElement>
>
export declare const Tag: ForwardRefExoticComponent<
  TagProps & RefAttributes<HTMLSpanElement>
>
export declare const Badge: ForwardRefExoticComponent<
  BadgeProps & RefAttributes<HTMLSpanElement>
>
export declare const Dot: ForwardRefExoticComponent<
  DotProps & RefAttributes<HTMLSpanElement>
>
export declare const Tooltip: FC<TooltipProps>
export declare const Tabs: ForwardRefExoticComponent<
  TabsProps & RefAttributes<HTMLDivElement>
>
export declare const OctoUIProvider: FC<OctoUIProviderProps>
