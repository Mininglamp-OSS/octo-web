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
import type { AvatarProps } from './components/Avatar/types'
import type { AvatarGroupProps } from './components/AvatarGroup/types'
import type { EmptyProps } from './components/Empty/types'
import type { LoadingProps } from './components/Loading/types'

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
export type {
  AvatarKind,
  AvatarProps,
  AvatarSize,
  AvatarTone,
} from './components/Avatar/types'
export type {
  AvatarGroupMax,
  AvatarGroupProps,
  AvatarGroupSize,
} from './components/AvatarGroup/types'
export type { EmptyProps } from './components/Empty/types'
export type {
  LoadingLayout,
  LoadingProps,
  LoadingSize,
} from './components/Loading/types'
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
export declare const Avatar: ForwardRefExoticComponent<
  AvatarProps & RefAttributes<HTMLSpanElement>
>
export declare const AvatarGroup: ForwardRefExoticComponent<
  AvatarGroupProps & RefAttributes<HTMLSpanElement>
>
export declare const Empty: ForwardRefExoticComponent<
  EmptyProps & RefAttributes<HTMLDivElement>
>
export declare const Loading: ForwardRefExoticComponent<
  LoadingProps & RefAttributes<HTMLSpanElement>
>
export declare const OctoUIProvider: FC<OctoUIProviderProps>
