import { forwardRef } from 'react'
import type { ButtonHTMLType, ButtonProps } from './types'

const htmlButtonTypes: ButtonHTMLType[] = ['button', 'submit', 'reset']

const normalizeVariant = (
  variant: ButtonProps['variant'],
  type: ButtonProps['type'],
  theme: ButtonProps['theme'],
) => {
  if (variant) {
    if (variant === 'ghost') return 'text'
    return variant
  }
  if (type === 'danger' && theme === 'borderless') return 'danger-text'
  if (type === 'danger') return theme === 'solid' ? 'danger' : 'warning'
  if (type === 'warning') return 'warning'
  if (theme === 'borderless') return 'text'
  if (theme === 'solid' && !type) return 'solid'
  if (type === 'primary') return theme === 'solid' ? 'solid' : 'secondary'
  return 'secondary'
}

const normalizeSize = (size: ButtonProps['size']) => {
  if (size === 'md') return 'sm'
  if (size === 'large') return 'sm'
  if (size === 'small') return 'xs'
  return size ?? 'sm'
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size = 'sm',
    loading = false,
    iconOnly = false,
    icon,
    children,
    className,
    disabled,
    type,
    htmlType,
    theme,
    ...rest
  },
  ref,
) {
  const normalizedVariant = normalizeVariant(variant, type, theme)
  const normalizedSize = normalizeSize(size)
  const nativeType = htmlType ?? (htmlButtonTypes.includes(type as ButtonHTMLType) ? type as ButtonHTMLType : 'button')
  const classes = [
    'octo-ui-button',
    `octo-ui-button--${normalizedVariant}`,
    `octo-ui-button--${normalizedSize}`,
    iconOnly ? 'octo-ui-button--icon-only' : '',
    loading ? 'octo-ui-button--loading' : '',
    className,
  ].filter(Boolean).join(' ')

  return (
    <button
      ref={ref}
      className={classes}
      disabled={disabled || loading}
      type={nativeType}
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
      {!iconOnly && children && (icon || loading) ? (
        <span className="octo-ui-button__label">{children}</span>
      ) : !iconOnly && children ? (
        children
      ) : null}
    </button>
  )
})

export default Button
export { Button }
