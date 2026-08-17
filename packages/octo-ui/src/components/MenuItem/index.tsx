import { forwardRef } from 'react'
import type { MenuItemProps } from './types'

const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  {
    icon,
    label,
    shortcut,
    suffix,
    selected = false,
    disabled = false,
    danger = false,
    size = 'default',
    children,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const classes = [
    'octo-ui-menu-item',
    `octo-ui-menu-item--${size}`,
    selected ? 'octo-ui-menu-item--selected' : '',
    danger ? 'octo-ui-menu-item--danger' : '',
    className,
  ].filter(Boolean).join(' ')
  const labelContent = label ?? children

  return (
    <button
      {...rest}
      ref={ref}
      className={classes}
      type={type}
      disabled={disabled}
    >
      {icon ? <span className="octo-ui-menu-item__icon" aria-hidden="true">{icon}</span> : null}
      <span className="octo-ui-menu-item__label">{labelContent}</span>
      {shortcut ? <span className="octo-ui-menu-item__shortcut">{shortcut}</span> : null}
      {suffix ? <span className="octo-ui-menu-item__suffix">{suffix}</span> : null}
    </button>
  )
})

export default MenuItem
export { MenuItem }
