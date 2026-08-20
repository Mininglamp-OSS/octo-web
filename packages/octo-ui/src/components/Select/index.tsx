import { IconChevronDown, IconClear, IconInbox, IconTick } from '@douyinfe/semi-icons'
import { Select as SemiSelect } from '@douyinfe/semi-ui'
import { forwardRef, useCallback, useState } from 'react'
import type { ComponentRef, FocusEvent, ReactNode } from 'react'
import type { SelectChangeValue, SelectOption, SelectOptionProps, SelectProps, SelectSize } from './types'

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const sizeClass: Record<SelectSize, string> = {
  small: 'octo-ui-select--small',
  default: 'octo-ui-select--default',
  large: 'octo-ui-select--large',
}

const DEFAULT_OPTION_LIST_MAX_HEIGHT = 268

function getOptionLabel(option: SelectOption) {
  return option.label ?? option.children ?? option.value
}

function renderTrigger(props: Record<string, any>) {
  const {
    componentProps,
    disabled,
    onClear,
    onRemove,
    placeholder,
    value = [],
  } = props
  const {
    clearable,
    multiple,
    showArrow = true,
    size = 'default',
  } = componentProps as SelectProps
  const selectedItems = Array.isArray(value) ? value : []
  const hasValue = selectedItems.length > 0

  return (
    <div className="octo-ui-select__trigger-inner">
      <div className={cx('octo-ui-select__value', multiple && 'octo-ui-select__value--multiple')}>
        {hasValue ? (
          multiple ? (
            <div className="octo-ui-select__chips">
              {selectedItems.map((item: SelectOption, index: number) => (
                <span className="octo-ui-select__chip" key={`${String(item.value)}-${index}`}>
                  <span className="octo-ui-select__chip-label">{getOptionLabel(item)}</span>
                  {!disabled ? (
                    <button
                      aria-label="Remove selected option"
                      className="octo-ui-select__chip-remove"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemove?.(item)
                      }}
                      tabIndex={-1}
                      type="button"
                    >
                      <IconClear aria-hidden="true" size="extra-small" />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : (
            <span className="octo-ui-select__text">{getOptionLabel(selectedItems[0])}</span>
          )
        ) : (
          <span className="octo-ui-select__placeholder">{placeholder}</span>
        )}
      </div>
      {clearable && hasValue && !disabled ? (
        <button
          aria-label="Clear selected option"
          className="octo-ui-select__clear"
          onClick={(event) => {
            event.stopPropagation()
            onClear?.()
          }}
          tabIndex={-1}
          type="button"
        >
          <IconClear aria-hidden="true" size="extra-small" />
        </button>
      ) : null}
      {showArrow ? (
        <span className={cx('octo-ui-select__arrow', size === 'small' && 'octo-ui-select__arrow--small')} aria-hidden="true">
          <IconChevronDown size="small" />
        </span>
      ) : null}
    </div>
  )
}

function renderEmptyContent(content: ReactNode = 'No options') {
  if (content === null || content === false) {
    return content
  }

  if (typeof content !== 'string' && typeof content !== 'number') {
    return content
  }

  return (
    <div className="octo-ui-select-empty">
      <IconInbox aria-hidden="true" className="octo-ui-select-empty__icon" />
      <span className="octo-ui-select-empty__text">{content}</span>
    </div>
  )
}

function renderOptionItem(option: Record<string, any>) {
  const {
    className,
    disabled,
    label,
    selected,
    showTick,
    children,
    value,
    onClick,
    onMouseEnter,
    style,
  } = option

  return (
    <div
      aria-disabled={disabled ? 'true' : 'false'}
      aria-selected={selected ? 'true' : 'false'}
      className={cx(
        'octo-ui-select-option',
        selected && 'octo-ui-select-option--selected',
        disabled && 'octo-ui-select-option--disabled',
        className,
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      style={style}
    >
      <span className="octo-ui-select-option__label">{label ?? children ?? value}</span>
      {selected && showTick !== false ? (
        <span className="octo-ui-select-option__check" aria-hidden="true">
          <IconTick size="small" />
        </span>
      ) : null}
    </div>
  )
}

const SelectOptionComponent = function SelectOption({ children, label, ...rest }: SelectOptionProps) {
  return (
    <SemiSelect.Option {...rest} label={label ?? children}>
      {children ?? label}
    </SemiSelect.Option>
  )
}

const Select = forwardRef<ComponentRef<typeof SemiSelect>, SelectProps>(function Select(
  {
    className,
    clearable,
    dropdownClassName,
    dropdownMatchSelectWidth = true,
    emptyContent,
    filter,
    maxHeight = DEFAULT_OPTION_LIST_MAX_HEIGHT,
    optionList,
    options,
    onChange,
    onBlur,
    onDropdownVisibleChange,
    onFocus,
    onValueChange,
    onSelect,
    placeholder,
    showArrow = true,
    size = 'default',
    status = 'default',
    ...rest
  },
  ref,
) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const classes = cx(
    'octo-ui-select',
    sizeClass[size],
    rest.multiple && 'octo-ui-select--multiple',
    rest.disabled && 'octo-ui-select--disabled',
    open && 'octo-ui-select--open',
    focused && 'octo-ui-select--focus',
    status !== 'default' && `octo-ui-select--${status}`,
    className,
  )

  const handleChange = useCallback((value: SelectChangeValue) => {
    onChange?.(value)
    onValueChange?.(value)
  }, [onChange, onValueChange])

  const handleSelect = useCallback((value: SelectChangeValue, option: Record<string, any>) => {
    onSelect?.(value, option as SelectOption)
  }, [onSelect])

  const handleDropdownVisibleChange = useCallback((visible: boolean) => {
    setOpen(visible)
    onDropdownVisibleChange?.(visible)
  }, [onDropdownVisibleChange])

  const handleFocus = useCallback((event: FocusEvent) => {
    setFocused(true)
    onFocus?.(event)
  }, [onFocus])

  const handleBlur = useCallback((event: FocusEvent) => {
    setFocused(false)
    onBlur?.(event)
  }, [onBlur])

  return (
    <SemiSelect
      {...rest}
      ref={ref}
      arrowIcon={<IconChevronDown size="small" />}
      className={classes}
      clearIcon={<IconClear size="extra-small" />}
      dropdownClassName={cx('octo-ui-select-dropdown', dropdownClassName)}
      dropdownMatchSelectWidth={dropdownMatchSelectWidth}
      emptyContent={renderEmptyContent(emptyContent)}
      filter={filter as never}
      maxHeight={maxHeight}
      optionList={optionList ?? options}
      placeholder={placeholder}
      renderOptionItem={renderOptionItem}
      showArrow={showArrow}
      showClear={clearable}
      size={size}
      triggerRender={renderTrigger}
      validateStatus={status}
      onBlur={handleBlur}
      onChange={handleChange as never}
      onDropdownVisibleChange={handleDropdownVisibleChange}
      onFocus={handleFocus}
      onSelect={handleSelect as never}
    />
  )
})

type SelectComponent = typeof Select & {
  Option: typeof SelectOptionComponent
}

const ExportedSelect = Select as SelectComponent
ExportedSelect.Option = SelectOptionComponent

export default ExportedSelect
export { ExportedSelect as Select }
export type { SelectChangeValue, SelectOption, SelectOptionProps, SelectProps, SelectSize, SelectStatus, SelectValue } from './types'
