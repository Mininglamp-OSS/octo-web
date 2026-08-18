import { forwardRef } from 'react'
import type { DotProps } from './types'

const Dot = forwardRef<HTMLSpanElement, DotProps>(function Dot(
  {
    size = 'default',
    tone = 'neutral',
    className,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const classes = [
    'octo-ui-dot',
    `octo-ui-dot--${size}`,
    `octo-ui-dot--${tone}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      ref={ref}
      className={classes}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      role={ariaLabel ? 'img' : undefined}
      {...rest}
    />
  )
})

export default Dot
export { Dot }
