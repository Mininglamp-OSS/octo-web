import { IconChevronDown, IconClear, IconInbox, IconTick } from '@douyinfe/semi-icons'
import LocaleConsumer from '@douyinfe/semi-ui/lib/es/locale/localeConsumer'
import SemiSelect from '@douyinfe/semi-ui/lib/es/select'
import { Children, forwardRef, isValidElement, useCallback, useMemo, useState } from 'react'
import type { ComponentRef, FocusEvent, ReactNode } from 'react'
import type { SelectChangeValue, SelectOption, SelectOptionProps, SelectProps, SelectSize } from './types'

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const sizeClass: Record<SelectSize, string> = {
  small: 'octo-ui-select--small',
  default: 'octo-ui-select--default',
  large: 'octo-ui-select--large',
}

const DEFAULT_OPTION_LIST_MAX_HEIGHT = 268
const DEFAULT_CLEAR_ARIA_LABEL = 'Clear'
const DEFAULT_REMOVE_OPTION_ARIA_LABEL = 'Remove'

interface SelectLocale {
  emptyText?: ReactNode
}

interface UploadLocale {
  clear?: string
}

interface DialogueLocale {
  delete?: string
}

function getOptionLabel(option: SelectOption) {
  return option.label ?? option.children ?? option.value
}

function getButtonAriaLabel(action: string | undefined, label?: ReactNode) {
  if (label === undefined || label === null || label === '') {
    return action
  }

  if (typeof label === 'string' || typeof label === 'number') {
    return `${action} ${label}`
  }

  return action
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
    clearAriaLabel,
    multiple,
    removeOptionAriaLabel,
    showArrow = true,
    showClear,
    size = 'default',
  } = componentProps as SelectProps & { showClear?: boolean }
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
                      aria-label={getButtonAriaLabel(removeOptionAriaLabel, getOptionLabel(item))}
                      className="octo-ui-select__chip-remove"
                      onClick={(event) => {
                        event.stopPropagation()
                        onRemove?.(item, event)
                      }}
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
      {showClear && hasValue && !disabled ? (
        <button
          aria-label={clearAriaLabel}
          className="octo-ui-select__clear"
          onClick={(event) => {
            event.stopPropagation()
            onClear?.(event)
          }}
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

function renderEmptyContentNode(content: ReactNode) {
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

function renderEmptyContent(content: ReactNode, locale: SelectLocale) {
  return renderEmptyContentNode(content === undefined ? locale.emptyText : content)
}

function getOptionMeta(children: ReactNode, options?: SelectOption[]) {
  const meta = new Map<SelectOption['value'], Pick<SelectOption, 'showTick'>>()

  options?.forEach((option) => {
    meta.set(option.value, { showTick: option.showTick })
  })

  Children.forEach(children, (child) => {
    if (!isValidElement<SelectOptionProps>(child)) {
      return
    }

    meta.set(child.props.value, { showTick: child.props.showTick })
  })

  return meta
}

function renderOptionItem(option: Record<string, any>, optionMeta: Map<SelectOption['value'], Pick<SelectOption, 'showTick'>>) {
  const {
    className,
    disabled,
    focused,
    label,
    selected,
    children,
    value,
    onClick,
    onMouseEnter,
    style,
  } = option
  const showTick = optionMeta.get(value)?.showTick

  return (
    <div
      aria-disabled={disabled ? 'true' : 'false'}
      aria-selected={selected ? 'true' : 'false'}
      className={cx(
        'octo-ui-select-option',
        selected && 'octo-ui-select-option--selected',
        focused && 'octo-ui-select-option--focused',
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

const SelectOptionComponent = function SelectOption({ children, label }: SelectOptionProps) {
  return <>{children ?? label}</>
}

;(SelectOptionComponent as typeof SelectOptionComponent & { isSelectOption?: boolean }).isSelectOption = true

const Select = forwardRef<ComponentRef<typeof SemiSelect>, SelectProps>(function Select(
  {
    className,
    clearable,
    clearAriaLabel,
    dropdownClassName,
    dropdownMatchSelectWidth = true,
    emptyContent,
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
    removeOptionAriaLabel,
    showArrow = true,
    size = 'default',
    status = 'default',
    ...rest
  },
  ref,
) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const resolvedOptions = optionList ?? options
  const optionMeta = useMemo(() => getOptionMeta(rest.children, resolvedOptions), [rest.children, resolvedOptions])
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

  const handleRenderOptionItem = useCallback((option: Record<string, any>) => (
    renderOptionItem(option, optionMeta)
  ), [optionMeta])

  return (
    <LocaleConsumer componentName="Select">
      {(selectLocale: SelectLocale) => (
        <LocaleConsumer componentName="Upload">
          {(uploadLocale: UploadLocale) => (
            <LocaleConsumer componentName="AIChatDialogue">
              {(dialogueLocale: DialogueLocale) => (
                <SemiSelect
                  {...rest}
                  {...{
                    clearAriaLabel: clearAriaLabel ?? uploadLocale?.clear ?? DEFAULT_CLEAR_ARIA_LABEL,
                    removeOptionAriaLabel: removeOptionAriaLabel ?? dialogueLocale?.delete ?? DEFAULT_REMOVE_OPTION_ARIA_LABEL,
                  }}
                  ref={ref}
                  arrowIcon={<IconChevronDown size="small" />}
                  className={classes}
                  clearIcon={<IconClear size="extra-small" />}
                  dropdownClassName={cx(
                    'octo-ui-select-dropdown',
                    !dropdownMatchSelectWidth && 'octo-ui-select-dropdown--bounded',
                    dropdownClassName,
                  )}
                  dropdownMatchSelectWidth={dropdownMatchSelectWidth}
                  emptyContent={renderEmptyContent(emptyContent, selectLocale)}
                  maxHeight={maxHeight}
                  optionList={resolvedOptions}
                  placeholder={placeholder}
                  renderOptionItem={handleRenderOptionItem}
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
              )}
            </LocaleConsumer>
          )}
        </LocaleConsumer>
      )}
    </LocaleConsumer>
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
