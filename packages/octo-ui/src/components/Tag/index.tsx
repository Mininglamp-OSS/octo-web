import { forwardRef } from 'react'
import type { TagProps } from './types'

const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  {
    variant = 'neutral',
    size = 'sm',
    icon,
    children,
    className,
    ...rest
  },
  ref,
) {
  const classes = [
    'octo-ui-tag',
    `octo-ui-tag--${variant}`,
    `octo-ui-tag--${size}`,
    className,
  ].filter(Boolean).join(' ')

  return (
    <span ref={ref} className={classes} {...rest}>
      {icon ? <span className="octo-ui-tag__icon" aria-hidden="true">{icon}</span> : null}
      <span className="octo-ui-tag__label">{children}</span>
    </span>
  )
})

export default Tag
export { Tag }
