import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

export type CheckboxSize = 'sm' | 'md'
export type CheckboxValue = string | number | boolean
export type CheckboxGroupDirection = 'horizontal' | 'vertical'

export interface CheckboxChangeEvent {
  target: {
    checked: boolean
    value?: CheckboxValue
    [key: string]: unknown
  }
  stopPropagation?: () => void
  preventDefault?: () => void
  nativeEvent?: {
    stopImmediatePropagation?: () => void
  }
}

export interface CheckboxProps {
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-invalid'?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-required'?: boolean
  checked?: boolean
  className?: string
  children?: ReactNode
  defaultChecked?: boolean
  disabled?: boolean
  extra?: ReactNode
  id?: string
  indeterminate?: boolean
  name?: string
  role?: string
  size?: CheckboxSize
  style?: CSSProperties
  tabIndex?: number
  value?: CheckboxValue
  onChange?: (event: CheckboxChangeEvent) => void
  onCheckedChange?: (checked: boolean, event: CheckboxChangeEvent) => void
  onMouseEnter?: MouseEventHandler<HTMLSpanElement>
  onMouseLeave?: MouseEventHandler<HTMLSpanElement>
}

export interface CheckboxGroupOption {
  label: ReactNode
  value: CheckboxValue
  disabled?: boolean
  extra?: ReactNode
  className?: string
  style?: CSSProperties
}

export interface CheckboxGroupProps {
  'aria-describedby'?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  children?: ReactNode
  className?: string
  defaultValue?: CheckboxValue[]
  disabled?: boolean
  direction?: CheckboxGroupDirection
  id?: string
  name?: string
  options?: CheckboxGroupOption[]
  size?: CheckboxSize
  style?: CSSProperties
  value?: CheckboxValue[]
  onChange?: (value: CheckboxValue[]) => void
  onValueChange?: (value: CheckboxValue[]) => void
}
