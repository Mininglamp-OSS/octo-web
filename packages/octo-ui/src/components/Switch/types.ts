import type { ChangeEvent, CSSProperties, MouseEventHandler, ReactNode } from 'react'

export type SwitchSize = 'sm' | 'md' | 'lg'

export type SwitchChangeEvent = ChangeEvent<HTMLInputElement>

export interface SwitchProps {
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-invalid'?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  checked?: boolean
  checkedText?: ReactNode
  className?: string
  defaultChecked?: boolean
  disabled?: boolean
  id?: string
  loading?: boolean
  size?: SwitchSize
  style?: CSSProperties
  uncheckedText?: ReactNode
  onChange?: (checked: boolean, event: SwitchChangeEvent) => void
  onCheckedChange?: (checked: boolean, event: SwitchChangeEvent) => void
  onMouseEnter?: MouseEventHandler<Element>
  onMouseLeave?: MouseEventHandler<Element>
}
