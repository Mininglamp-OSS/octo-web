import { Children, cloneElement, forwardRef, isValidElement } from 'react'
import type { ComponentRef } from 'react'
import { Radio as SemiRadio, RadioGroup as SemiRadioGroup } from '@douyinfe/semi-ui'
import type { RadioChangeEvent, RadioGroupProps, RadioProps, RadioValue } from './types'

const radioPrefixCls = 'octo-ui-radio-semi'
const radioGroupPrefixCls = 'octo-ui-radio-group-semi'

const cx = (classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const Radio = forwardRef<ComponentRef<typeof SemiRadio>, RadioProps>(function Radio(
  {
    size = 'md',
    className,
    onChange,
    onCheckedChange,
    ...rest
  },
  ref,
) {
  const classes = cx([
    'octo-ui-radio',
    `octo-ui-radio--${size}`,
    className,
  ])

  const handleChange = (event: RadioChangeEvent) => {
    onChange?.(event)
    onCheckedChange?.(Boolean(event.target.checked), event)
  }

  return (
    <SemiRadio
      {...rest}
      ref={ref}
      className={classes}
      prefixCls={radioPrefixCls}
      onChange={handleChange as never}
    />
  )
})

function RadioGroup({
  size = 'md',
  direction = 'vertical',
  className,
  children,
  options,
  onChange,
  onValueChange,
  ...rest
}: RadioGroupProps) {
  const classes = cx([
    'octo-ui-radio-group',
    `octo-ui-radio-group--${size}`,
    `octo-ui-radio-group--${direction}`,
    className,
  ])

  const handleChange = (event: RadioChangeEvent) => {
    onChange?.(event)
    onValueChange?.(event.target.value as RadioValue, event)
  }

  const items = options
    ? options.map(option => (
      <Radio
        key={String(option.value)}
        className={option.className}
        disabled={option.disabled}
        extra={option.extra}
        size={size}
        style={option.style}
        value={option.value}
      >
        {option.label}
      </Radio>
    ))
    : Children.map(children, child => {
      if (!isValidElement<RadioProps>(child)) return child
      return cloneElement(child, { size: child.props.size ?? size })
    })

  return (
    <SemiRadioGroup
      {...rest}
      className={classes}
      direction={direction}
      prefixCls={radioGroupPrefixCls}
      onChange={handleChange as never}
    >
      {items}
    </SemiRadioGroup>
  )
}

export default Radio
export { Radio, RadioGroup }
