import { IconAlertCircle, IconSearchStroked } from '@douyinfe/semi-icons'
import SemiInput from '@douyinfe/semi-ui/lib/es/input'
import SemiTextArea from '@douyinfe/semi-ui/lib/es/input/textarea'
import { forwardRef, useState } from 'react'
import type { ComponentRef, KeyboardEvent } from 'react'
import type { InputProps, InputSearchProps, InputSize, InputStatus, InputTextAreaProps } from './types'

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const sizeClass: Record<'small' | 'default' | 'large', string> = {
  small: 'octo-ui-input--small',
  default: 'octo-ui-input--default',
  large: 'octo-ui-input--large',
}

function normalizeSize(size: InputSize = 'default'): 'small' | 'default' | 'large' {
  if (size === 'sm') return 'small'
  if (size === 'md') return 'default'
  if (size === 'lg') return 'large'
  return size
}

function normalizeStatus(status?: InputStatus, validateStatus?: InputStatus, error?: boolean): InputStatus {
  if (error) return 'error'
  return status ?? validateStatus ?? 'default'
}

function renderAffix(node: React.ReactNode, position: 'prefix' | 'suffix') {
  if (node === undefined || node === null || node === false) {
    return undefined
  }

  const isText = typeof node === 'string' || typeof node === 'number'
  return (
    <span className={cx(
      `octo-ui-input__${position}`,
      isText ? 'octo-ui-input__affix--text' : 'octo-ui-input__affix--custom',
    )}>
      {node}
    </span>
  )
}

function getInputClasses(
  className: string | undefined,
  size: InputSize | undefined,
  status: InputStatus,
  disabled: boolean | undefined,
  round?: boolean,
  hasPrefix?: boolean,
  hasSuffix?: boolean,
) {
  const normalizedSize = normalizeSize(size)
  return cx(
    'octo-ui-input',
    sizeClass[normalizedSize],
    round && 'octo-ui-input--round',
    status !== 'default' && `octo-ui-input--${status}`,
    disabled && 'octo-ui-input--disabled',
    hasPrefix && 'octo-ui-input--has-prefix',
    hasSuffix && 'octo-ui-input--has-suffix',
    className,
  )
}

const InputBase = forwardRef<ComponentRef<typeof SemiInput>, InputProps>(function Input(
  {
    className,
    disabled,
    error,
    onEnterPress,
    prefix,
    size = 'default',
    status,
    suffix,
    validateStatus,
    ...rest
  },
  ref,
) {
  const resolvedStatus = normalizeStatus(status, validateStatus, error)

  return (
    <SemiInput
      {...rest}
      ref={ref}
      className={getInputClasses(className, size, resolvedStatus, disabled, false, Boolean(prefix), Boolean(suffix))}
      disabled={disabled}
      prefix={renderAffix(prefix, 'prefix')}
      size={normalizeSize(size)}
      suffix={renderAffix(suffix, 'suffix')}
      validateStatus={resolvedStatus}
      onEnterPress={onEnterPress as never}
    />
  )
})

const Search = forwardRef<ComponentRef<typeof SemiInput>, InputSearchProps>(function InputSearch(
  {
    className,
    disabled,
    error,
    searchIcon,
    size = 'default',
    status,
    suffix,
    validateStatus,
    ...rest
  },
  ref,
) {
  const resolvedStatus = normalizeStatus(status, validateStatus, error)
  const prefix = (
    <span className="octo-ui-input__prefix octo-ui-input__affix--icon">
      {searchIcon ?? <IconSearchStroked aria-hidden="true" size="small" />}
    </span>
  )

  return (
    <SemiInput
      {...rest}
      ref={ref}
      className={getInputClasses(className, size, resolvedStatus, disabled, true, true, Boolean(suffix))}
      disabled={disabled}
      prefix={prefix}
      size={normalizeSize(size)}
      suffix={renderAffix(suffix, 'suffix')}
      validateStatus={resolvedStatus}
    />
  )
})

const TextArea = forwardRef<ComponentRef<typeof SemiTextArea>, InputTextAreaProps>(function InputTextArea(
  {
    allowWrap = true,
    className,
    defaultValue,
    disabled,
    disabledEnterStartNewLine,
    error,
    getValueLength,
    maxCount,
    onChange,
    onEnterPress,
    onKeyDown,
    showCount,
    showCounter,
    size,
    status,
    validateStatus,
    value,
    ...rest
  },
  ref,
) {
  const resolvedStatus = normalizeStatus(status, validateStatus, error)
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '')
  const countValue = value ?? uncontrolledValue
  const count = getValueLength ? getValueLength(String(countValue)) : String(countValue).length
  const showCountNode = showCount ?? showCounter ?? Boolean(maxCount)

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((disabledEnterStartNewLine || !allowWrap) && event.key === 'Enter') {
      event.preventDefault()
    }
    if (event.key === 'Enter') {
      onEnterPress?.(event)
    }
    onKeyDown?.(event)
  }

  return (
    <div
      className={cx(
        'octo-ui-textarea',
        size && `octo-ui-textarea--${size}`,
        resolvedStatus !== 'default' && `octo-ui-textarea--${resolvedStatus}`,
        disabled && 'octo-ui-textarea--disabled',
        showCountNode && 'octo-ui-textarea--with-count',
        className,
      )}
    >
      <SemiTextArea
        {...rest}
        ref={ref}
        className="octo-ui-textarea__control"
        defaultValue={defaultValue}
        disabled={disabled}
        validateStatus={resolvedStatus}
        value={value}
        onChange={(next, event) => {
          if (value === undefined) {
            setUncontrolledValue(next)
          }
          onChange?.(next, event as never)
        }}
        onKeyDown={handleKeyDown}
      />
      {showCountNode ? (
        <span
          className={cx(
            'octo-ui-textarea__count',
            maxCount !== undefined && count > maxCount && 'octo-ui-textarea__count--exceeded',
          )}
        >
          {count}{maxCount !== undefined ? `/${maxCount}` : ''}
        </span>
      ) : null}
    </div>
  )
})

function ErrorMessage({ children, id }: { children: React.ReactNode; id?: string }) {
  if (!children) return null

  return (
    <div className="octo-ui-input-error" id={id}>
      <span className="octo-ui-input-error__icon" aria-hidden="true">
        <IconAlertCircle size="small" />
      </span>
      <span className="octo-ui-input-error__text">{children}</span>
    </div>
  )
}

type InputComponent = typeof InputBase & {
  ErrorMessage: typeof ErrorMessage
  Search: typeof Search
  TextArea: typeof TextArea
}

const Input = InputBase as InputComponent
Input.Search = Search
Input.TextArea = TextArea
Input.ErrorMessage = ErrorMessage

export default Input
export { Input, Search as InputSearch, TextArea as InputTextArea, ErrorMessage as InputErrorMessage }
export type { InputProps, InputSearchProps, InputSize, InputStatus, InputTextAreaProps } from './types'
