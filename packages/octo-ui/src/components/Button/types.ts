import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonHTMLType = 'button' | 'submit' | 'reset'
export type ButtonLegacyType = 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger'
export type ButtonLegacyTheme = 'solid' | 'light' | 'borderless' | 'outline'
export type ButtonVariant =
  | 'solid'
  | 'brand'
  | 'secondary'
  | 'text'
  | 'warning'
  | 'danger'
  /** @deprecated Use text. */
  | 'ghost'
export type ButtonSize =
  | 'sm'
  | 'xs'
  /** @deprecated Use sm. */
  | 'md'
  /** @deprecated Use sm. */
  | 'large'
  /** @deprecated Use xs. */
  | 'small'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'size'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /**
   * Native button type. Prefer this when the button submits a form.
   */
  htmlType?: ButtonHTMLType
  /**
   * @deprecated Semi-compatible visual type. Use variant instead.
   */
  type?: ButtonHTMLType | ButtonLegacyType
  /**
   * @deprecated Semi-compatible theme. Use variant instead.
   */
  theme?: ButtonLegacyTheme
  loading?: boolean
  iconOnly?: boolean
  icon?: ReactNode
  children?: ReactNode
}
