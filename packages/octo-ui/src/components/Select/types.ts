import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import type { DropdownPosition } from '../Dropdown/types'

export type SelectValue = string | number
export type SelectChangeValue = SelectValue | SelectValue[] | undefined
export type SelectSize = 'small' | 'default' | 'large'
export type SelectStatus = 'default' | 'error' | 'warning' | 'success'

export interface SelectOption {
  value: SelectValue
  label?: ReactNode
  children?: ReactNode
  disabled?: boolean
  className?: string
  style?: CSSProperties
  [key: string]: unknown
}

export interface SelectOptionProps extends SelectOption {
  children?: ReactNode
}

export interface SelectProps {
  'aria-describedby'?: string
  'aria-errormessage'?: string
  'aria-invalid'?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-required'?: boolean
  autoAdjustOverflow?: boolean
  autoClearSearchValue?: boolean
  autoFocus?: boolean
  children?: ReactNode
  className?: string
  clearable?: boolean
  defaultOpen?: boolean
  defaultValue?: SelectChangeValue
  disabled?: boolean
  dropdownClassName?: string
  dropdownMatchSelectWidth?: boolean
  dropdownStyle?: CSSProperties
  emptyContent?: ReactNode
  filter?: boolean | ((inputValue: string, option: SelectOption) => boolean)
  getPopupContainer?: () => HTMLElement
  id?: string
  inputProps?: Record<string, unknown>
  loading?: boolean
  max?: number
  maxHeight?: number | string
  maxTagCount?: number
  motion?: boolean
  multiple?: boolean
  optionList?: SelectOption[]
  options?: SelectOption[]
  placeholder?: ReactNode
  position?: DropdownPosition
  searchPlaceholder?: string
  showArrow?: boolean
  size?: SelectSize
  status?: SelectStatus
  style?: CSSProperties
  value?: SelectChangeValue
  zIndex?: number
  onBlur?: (event: FocusEvent) => void
  onChange?: (value: SelectChangeValue) => void
  onClear?: () => void
  onDropdownVisibleChange?: (visible: boolean) => void
  onFocus?: (event: FocusEvent) => void
  onSearch?: (value: string, event: KeyboardEvent | MouseEvent) => void
  onSelect?: (value: SelectChangeValue, option: SelectOption) => void
  onValueChange?: (value: SelectChangeValue) => void
}
