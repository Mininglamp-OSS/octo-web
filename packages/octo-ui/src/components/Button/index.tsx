import { forwardRef } from 'react'
import type { ButtonProps } from './types'

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconOnly = false,
    icon,
    children,
    className,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const classes = [
    'octo-ui-button',
    `octo-ui-button--${variant}`,
    `octo-ui-button--${size}`,
    iconOnly ? 'octo-ui-button--icon-only' : '',
    loading ? 'octo-ui-button--loading' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      type={type ?? 'button'}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span className="octo-ui-button__spinner" aria-hidden="true" />
      ) : icon ? (
        <span className="octo-ui-button__icon" aria-hidden={iconOnly || undefined}>
          {icon}
        </span>
      ) : null}
      {!iconOnly && children ? (
        <span className="octo-ui-button__label">{children}</span>
      ) : null}
    </button>
  )
})

export default Button
export { Button }
