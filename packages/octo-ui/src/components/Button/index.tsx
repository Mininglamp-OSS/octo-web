import SemiButton from '@douyinfe/semi-ui/lib/es/button'
import { forwardRef, useImperativeHandle, useRef } from 'react'
import { findDOMNode } from 'react-dom'
import type { ComponentRef, MouseEvent } from 'react'
import type { ButtonHTMLType, ButtonProps, ButtonSemiSize, ButtonSemiTheme, ButtonSemiType } from './types'

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
  if (type === 'secondary' || type === 'tertiary') return 'secondary'
  if (type === 'primary' || !type) return theme === 'solid' ? 'solid' : 'tint'
  return 'secondary'
}

const normalizeSize = (size: ButtonProps['size']) => {
  if (size === 'md') return 'sm'
  if (size === 'large') return 'sm'
  if (size === 'small') return 'xs'
  return size ?? 'sm'
}

const mapSemiVisual = (variant: Exclude<ReturnType<typeof normalizeVariant>, undefined>): {
  type: ButtonSemiType
  theme: ButtonSemiTheme
} => {
  switch (variant) {
    case 'solid':
    case 'brand':
      return { type: 'primary', theme: 'solid' }
    case 'secondary':
      return { type: 'tertiary', theme: 'light' }
    case 'text':
      return { type: 'primary', theme: 'borderless' }
    case 'warning':
      return { type: 'warning', theme: 'light' }
    case 'danger':
      return { type: 'danger', theme: 'solid' }
    case 'danger-text':
      return { type: 'danger', theme: 'borderless' }
    case 'tint':
    default:
      return { type: 'primary', theme: 'light' }
  }
}

const mapSemiSize = (size: Exclude<ReturnType<typeof normalizeSize>, undefined>): ButtonSemiSize => {
  if (size === 'xs') return 'small'
  return 'default'
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
    onClick,
    ...rest
  },
  ref,
) {
  const semiRef = useRef<ComponentRef<typeof SemiButton>>(null)
  const normalizedVariant = normalizeVariant(variant, type, theme)
  const normalizedSize = normalizeSize(size)
  const semiVisual = mapSemiVisual(normalizedVariant)
  const semiSize = mapSemiSize(normalizedSize)
  const nativeType = htmlType ?? (htmlButtonTypes.includes(type as ButtonHTMLType) ? type as ButtonHTMLType : 'button')
  const classes = [
    'octo-ui-button',
    `octo-ui-button--${normalizedVariant}`,
    `octo-ui-button--${normalizedSize}`,
    iconOnly ? 'octo-ui-button--icon-only' : '',
    loading ? 'octo-ui-button--loading' : '',
    className,
  ].filter(Boolean).join(' ')

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    onClick?.(event)
  }

  useImperativeHandle(ref, () => {
    const node = semiRef.current ? findDOMNode(semiRef.current) : null
    return node instanceof HTMLButtonElement ? node : document.createElement('button')
  })

  return (
    <SemiButton
      ref={semiRef}
      className={classes}
      disabled={disabled}
      htmlType={nativeType}
      icon={icon}
      loading={loading}
      noHorizontalPadding={iconOnly}
      size={semiSize}
      theme={semiVisual.theme}
      type={semiVisual.type}
      aria-busy={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      {iconOnly ? null : children}
    </SemiButton>
  )
})

export default Button
export { Button }
