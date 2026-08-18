import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

export type RadioSize = 'sm' | 'md'
export type RadioValue = string | number | boolean
export type RadioGroupDirection = 'horizontal' | 'vertical'

export interface RadioChangeEvent {
  target: {
    checked: boolean
    value: RadioValue
    [key: string]: unknown
  }
  stopPropagation?: () => void
  preventDefault?: () => void
}

export interface RadioProps {
  'aria-label'?: string
  autoFocus?: boolean
  checked?: boolean
  className?: string
  children?: ReactNode
  defaultChecked?: boolean
  disabled?: boolean
  extra?: ReactNode
  id?: string
  name?: string
  size?: RadioSize
  style?: CSSProperties
  value?: RadioValue
  onChange?: (event: RadioChangeEvent) => void
  onCheckedChange?: (checked: boolean, event: RadioChangeEvent) => void
  onMouseEnter?: MouseEventHandler<HTMLLabelElement>
  onMouseLeave?: MouseEventHandler<HTMLLabelElement>
}

export interface RadioGroupOption {
  label: ReactNode
  value: RadioValue
  className?: string
  disabled?: boolean
  extra?: ReactNode
  style?: CSSProperties
}

export interface RadioGroupProps {
  'aria-describedby'?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  children?: ReactNode
  className?: string
  defaultValue?: RadioValue
  disabled?: boolean
  direction?: RadioGroupDirection
  id?: string
  name?: string
  options?: RadioGroupOption[]
  size?: RadioSize
  style?: CSSProperties
  value?: RadioValue
  onChange?: (event: RadioChangeEvent) => void
  onValueChange?: (value: RadioValue, event: RadioChangeEvent) => void
}
