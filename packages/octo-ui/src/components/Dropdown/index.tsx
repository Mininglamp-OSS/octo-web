import { Dropdown as SemiDropdown } from '@douyinfe/semi-ui'
import { forwardRef, useCallback, useContext, useMemo, useState } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react'
import MenuItem from '../MenuItem'
import { DropdownContext } from './context'
import type {
  DropdownDividerProps,
  DropdownItemConfig,
  DropdownItemKey,
  DropdownItemProps,
  DropdownMenuProps,
  DropdownProps,
} from './types'

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function isDangerItem(item: Pick<DropdownItemConfig, 'danger' | 'type'>) {
  return item.danger || item.type === 'danger' || item.type === 'warning'
}

function getFocusableMenuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLButtonElement>(
    ':scope > .octo-ui-dropdown-item-shell[aria-disabled="false"] > button[role="menuitem"]',
  ))
}

const DropdownMenu = forwardRef<HTMLUListElement, DropdownMenuProps>(function DropdownMenu(
  { children, className, style, width, maxHeight, onKeyDown, ...rest },
  ref,
) {
  const scrollable = maxHeight !== undefined
  const menuStyle = {
    ...style,
    ...(width === undefined ? null : { width }),
    ...(maxHeight === undefined ? null : { maxHeight }),
  }

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLUListElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return

    const items = getFocusableMenuItems(event.currentTarget)
    if (items.length === 0) return

    const currentItem = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[role="menuitem"]')
    const currentIndex = currentItem ? items.indexOf(currentItem) : -1
    let nextIndex = currentIndex

    switch (event.key) {
      case 'ArrowDown':
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
        break
      case 'ArrowUp':
        nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = items.length - 1
        break
      case 'Enter':
      case ' ':
        if (currentItem) {
          event.preventDefault()
          currentItem.click()
        }
        return
      default:
        return
    }

    event.preventDefault()
    items[nextIndex]?.focus()
  }, [onKeyDown])

  return (
    <ul
      {...rest}
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className={joinClasses('octo-ui-dropdown-menu', scrollable && 'octo-ui-dropdown-menu--scrollable', className)}
      onKeyDown={handleKeyDown}
      style={menuStyle}
    >
      {children}
    </ul>
  )
})

const DropdownItem = forwardRef<HTMLButtonElement, DropdownItemProps>(function DropdownItem(
  {
    itemKey,
    label,
    children,
    active,
    selected,
    danger,
    type,
    size = 'compact',
    closeOnSelect,
    onSelect,
    onClick,
    className,
    shellClassName,
    submenu,
    disabled,
    ...rest
  },
  ref,
) {
  const context = useContext(DropdownContext)
  const shouldCloseOnSelect = closeOnSelect ?? context.closeOnSelect

  const handleClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event)
    if (event.defaultPrevented) return

    onSelect?.(event)
    if (!event.defaultPrevented && shouldCloseOnSelect) {
      window.setTimeout(context.close, 0)
    }
  }, [context, onClick, onSelect, shouldCloseOnSelect])

  const handleShellFocus = useCallback((event: FocusEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return
    event.currentTarget.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus()
  }, [])

  return (
    <li
      aria-disabled={disabled ? 'true' : 'false'}
      className={joinClasses('octo-ui-dropdown-item-shell', shellClassName)}
      data-octo-dropdown-item-key={itemKey}
      onFocus={handleShellFocus}
      role="none"
    >
      <MenuItem
        {...rest}
        ref={ref}
        aria-disabled={disabled ? 'true' : 'false'}
        role={rest.role ?? 'menuitem'}
        tabIndex={disabled ? undefined : -1}
        className={joinClasses(className, active ? 'octo-ui-dropdown-item--active' : undefined)}
        size={size}
        selected={selected ?? active}
        danger={danger ?? isDangerItem({ danger, type })}
        disabled={disabled}
        label={label ?? children}
        onClick={handleClick}
      />
      {submenu}
    </li>
  )
})

function DropdownDivider({ className, style }: DropdownDividerProps) {
  return (
    <li
      className={joinClasses('octo-ui-dropdown-divider', className)}
      role="separator"
      style={style}
    />
  )
}

function renderItems(
  items: DropdownItemConfig[],
  onAction?: (key: DropdownItemKey, event: MouseEvent<HTMLButtonElement>) => void,
) {
  return (
    <DropdownMenu>
      {items.map((item) => (
        <DropdownItem
          key={item.key}
          itemKey={item.key}
          icon={item.icon}
          label={item.label}
          shortcut={item.shortcut}
          suffix={item.suffix}
          selected={item.selected ?? item.active}
          disabled={item.disabled}
          danger={isDangerItem(item)}
          className={item.className}
          style={item.style}
          closeOnSelect={item.closeOnSelect}
          data-testid={item['data-testid']}
          onSelect={(event) => onAction?.(item.key, event)}
        />
      ))}
    </DropdownMenu>
  )
}

function Dropdown({
  children,
  overlay,
  render,
  items,
  trigger = 'click',
  position = 'bottomLeft',
  visible,
  onVisibleChange,
  onAction,
  closeOnSelect = true,
  renderInPortal,
  getPopupContainer,
  spacing,
  zIndex,
  className,
  contentClassName,
  overlayClassName,
  style,
  overlayStyle,
  width,
  minWidth,
  disabled,
  motion,
  rePosKey,
  closeOnEsc,
}: DropdownProps) {
  const [internalVisible, setInternalVisible] = useState(false)
  const isControlled = visible !== undefined
  const actualVisible = isControlled ? visible : internalVisible

  const setVisible = useCallback((nextVisible: boolean) => {
    if (!isControlled) {
      setInternalVisible(nextVisible)
    }
    onVisibleChange?.(nextVisible)
  }, [isControlled, onVisibleChange])

  const contextValue = useMemo(() => ({
    closeOnSelect,
    close: () => setVisible(false),
  }), [closeOnSelect, setVisible])

  const overlayContent = overlay ?? render ?? (items ? renderItems(items, onAction) : null)
  const rootStyle = {
    ...overlayStyle,
    ...(width === undefined ? null : { width }),
    ...(minWidth === undefined ? null : { minWidth }),
  }
  const renderContent = (
    <DropdownContext.Provider value={contextValue}>
      <div
        className={joinClasses('octo-ui-dropdown', overlayClassName)}
        style={rootStyle}
      >
        {overlayContent}
      </div>
    </DropdownContext.Provider>
  )

  return (
    <SemiDropdown
      className={className}
      closeOnEsc={closeOnEsc}
      contentClassName={joinClasses('octo-ui-dropdown-popover', contentClassName)}
      disabled={disabled}
      getPopupContainer={getPopupContainer}
      motion={motion}
      onVisibleChange={setVisible}
      position={position}
      rePosKey={rePosKey}
      render={renderContent}
      renderInPortal={renderInPortal}
      spacing={spacing}
      style={style}
      trigger={trigger}
      visible={actualVisible}
      zIndex={zIndex}
    >
      {children}
    </SemiDropdown>
  )
}

Dropdown.Menu = DropdownMenu
Dropdown.Item = DropdownItem
Dropdown.Divider = DropdownDivider

export default Dropdown
export { Dropdown, DropdownDivider, DropdownItem, DropdownMenu }
