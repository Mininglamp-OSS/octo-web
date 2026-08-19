import { forwardRef } from 'react'
import type { ComponentRef } from 'react'
import { Switch as SemiSwitch } from '@douyinfe/semi-ui'
import type { SwitchChangeEvent, SwitchProps, SwitchSize } from './types'

const cx = (classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const semiSizeByOctoSize: Record<SwitchSize, 'small' | 'default' | 'large'> = {
  sm: 'small',
  md: 'default',
  lg: 'large',
}

const Switch = forwardRef<ComponentRef<typeof SemiSwitch>, SwitchProps>(function Switch(
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
    'octo-ui-switch',
    `octo-ui-switch--${size}`,
    className,
  ])

  const handleChange = (checked: boolean, event: SwitchChangeEvent) => {
    onChange?.(checked, event)
    onCheckedChange?.(checked, event)
  }

  return (
    <SemiSwitch
      {...rest}
      ref={ref}
      className={classes}
      size={semiSizeByOctoSize[size]}
      onChange={handleChange}
    />
  )
})

export default Switch
export { Switch }
