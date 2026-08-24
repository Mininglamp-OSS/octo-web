import type {
  ChangeEvent,
  CSSProperties,
  FocusEvent,
  InputHTMLAttributes,
  KeyboardEvent,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'
import type { InputProps as SemiInputProps } from '@douyinfe/semi-ui/lib/es/input'
import type { TextAreaProps as SemiTextAreaProps } from '@douyinfe/semi-ui/lib/es/input/textarea'

export type InputSize = 'small' | 'default' | 'large' | 'sm' | 'md' | 'lg'
export type InputStatus = 'default' | 'error' | 'warning' | 'success'

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onInput' | 'prefix' | 'size' | 'value' | 'defaultValue'>
type NativeTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'onInput' | 'prefix' | 'size' | 'value' | 'defaultValue'>

export interface InputProps extends NativeInputProps {
  addonAfter?: ReactNode
  addonBefore?: ReactNode
  borderless?: boolean
  className?: string
  clearIcon?: ReactNode
  defaultValue?: string | number
  disabled?: boolean
  error?: boolean
  hideSuffix?: boolean
  inputStyle?: CSSProperties
  insetLabel?: ReactNode
  insetLabelId?: string
  mode?: SemiInputProps['mode']
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void
  onChange?: (value: string, event: React.ChangeEvent<HTMLInputElement>) => void
  onClear?: SemiInputProps['onClear']
  onEnterPress?: (event: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
  onInput?: SemiInputProps['onInput']
  prefix?: ReactNode
  readonly?: boolean
  showClear?: boolean
  size?: InputSize
  status?: InputStatus
  suffix?: ReactNode
  validateStatus?: InputStatus
  value?: string | number
}

export interface InputSearchProps extends Omit<InputProps, 'prefix' | 'round' | 'type'> {
  searchIcon?: ReactNode
}

export interface InputTextAreaProps extends NativeTextAreaProps {
  allowWrap?: boolean
  autosize?: SemiTextAreaProps['autosize']
  borderless?: boolean
  className?: string
  defaultValue?: string
  disabled?: boolean
  disabledEnterStartNewLine?: boolean
  error?: boolean
  getValueLength?: SemiTextAreaProps['getValueLength']
  maxCount?: number
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void
  onClear?: SemiTextAreaProps['onClear']
  onEnterPress?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void
  onInput?: SemiTextAreaProps['onInput']
  onPressEnter?: SemiTextAreaProps['onPressEnter']
  readonly?: boolean
  rows?: number
  showClear?: boolean
  showCount?: boolean
  showCounter?: boolean
  size?: Exclude<InputSize, 'sm' | 'md' | 'lg'>
  status?: InputStatus
  validateStatus?: InputStatus
  value?: string
}
