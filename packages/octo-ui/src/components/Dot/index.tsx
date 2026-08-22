import { forwardRef } from 'react'
import type { DotProps } from './types'

const Dot = forwardRef<HTMLSpanElement, DotProps>(function Dot(
  {
    size = 'default',
    tone = 'neutral',
    className,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    title,
    role,
    'aria-hidden': ariaHidden,
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

  const isLabelled = Boolean(ariaLabel || ariaLabelledBy || title)

  return (
    <span
      ref={ref}
      className={classes}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-hidden={ariaHidden ?? (isLabelled ? undefined : true)}
      title={title}
      role={role ?? (isLabelled ? 'img' : undefined)}
      {...rest}
    />
  )
})

export default Dot
export { Dot }
