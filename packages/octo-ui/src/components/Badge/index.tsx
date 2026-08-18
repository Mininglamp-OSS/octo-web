import { forwardRef } from 'react'
import type { BadgeProps } from './types'

const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  {
    variant = 'strong',
    size = 'default',
    count,
    overflowCount = 99,
    showZero = false,
    children,
    className,
    ...rest
  },
  ref,
) {
  if (count === 0 && !showZero) return null

  const content =
    count === undefined
      ? children
      : overflowCount !== null && count > overflowCount
      ? `${overflowCount}+`
      : count

  if (content === undefined || content === null) return null

  const classes = [
    'octo-ui-badge',
    `octo-ui-badge--${variant}`,
    `octo-ui-badge--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span ref={ref} className={classes} {...rest}>
      {content}
    </span>
  )
})

export default Badge
export { Badge }
