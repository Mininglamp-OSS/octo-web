import { Children, cloneElement, forwardRef, isValidElement } from 'react'
import type { ComponentRef } from 'react'
import SemiCheckboxWithGroup, { Checkbox as SemiCheckbox } from '@douyinfe/semi-ui/lib/es/checkbox'
import type { CheckboxChangeEvent, CheckboxGroupProps, CheckboxProps } from './types'

const checkboxPrefixCls = 'octo-ui-checkbox-semi'
const checkboxGroupPrefixCls = 'octo-ui-checkbox-group-semi'
const SemiCheckboxGroup = SemiCheckboxWithGroup.Group

const cx = (classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const Checkbox = forwardRef<ComponentRef<typeof SemiCheckbox>, CheckboxProps>(function Checkbox(
  {
    size = 'md',
    shape = 'square',
    className,
    onChange,
    onCheckedChange,
    ...rest
  },
  ref,
) {
  const classes = cx([
    'octo-ui-checkbox',
    `octo-ui-checkbox--${size}`,
    `octo-ui-checkbox--${shape}`,
    className,
  ])

  const handleChange = (event: CheckboxChangeEvent) => {
    onChange?.(event)
    onCheckedChange?.(Boolean(event.target.checked), event)
  }

  return (
    <SemiCheckbox
      {...rest}
      ref={ref}
      className={classes}
      prefixCls={checkboxPrefixCls}
      onChange={handleChange as never}
    />
  )
})

function CheckboxGroup({
  size = 'md',
  direction = 'vertical',
  className,
  children,
  options,
  onChange,
  onValueChange,
  ...rest
}: CheckboxGroupProps) {
  const classes = cx([
    'octo-ui-checkbox-group',
    `octo-ui-checkbox-group--${size}`,
    `octo-ui-checkbox-group--${direction}`,
    className,
  ])

  const handleChange = (value: Array<string | number | boolean>) => {
    onChange?.(value)
    onValueChange?.(value)
  }

  const items = options
    ? options.map(option => (
      <Checkbox
        key={String(option.value)}
        className={option.className}
        disabled={option.disabled}
        extra={option.extra}
        size={size}
        style={option.style}
        value={option.value}
      >
        {option.label}
      </Checkbox>
    ))
    : Children.map(children, child => {
      if (!isValidElement<CheckboxProps>(child)) return child
      return cloneElement(child, { size: child.props.size ?? size })
    })

  return (
    <SemiCheckboxGroup
      {...rest}
      className={classes}
      direction={direction}
      prefixCls={checkboxGroupPrefixCls}
      onChange={handleChange}
    >
      {items}
    </SemiCheckboxGroup>
  )
}

export default Checkbox
export { Checkbox, CheckboxGroup }
