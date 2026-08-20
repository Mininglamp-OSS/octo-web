import { Dropdown as SemiDropdown } from '@douyinfe/semi-ui'
import { forwardRef, useCallback, useContext, useMemo, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
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

const DropdownMenu = forwardRef<HTMLDivElement, DropdownMenuProps>(function DropdownMenu(
  { children, className, style, width, maxHeight },
  ref,
) {
  const menuStyle = {
    ...style,
    ...(width === undefined ? null : { width }),
    ...(maxHeight === undefined ? null : { maxHeight }),
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className={joinClasses('octo-ui-dropdown-menu', className)}
      style={menuStyle}
    >
      {children}
    </div>
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

  return (
    <MenuItem
      {...rest}
      ref={ref}
      role={rest.role ?? 'menuitem'}
      className={joinClasses(className, active ? 'octo-ui-dropdown-item--active' : undefined)}
      size={size}
      selected={selected ?? active}
      danger={danger ?? isDangerItem({ danger, type })}
      label={label ?? children}
      onClick={handleClick}
    />
  )
})

function DropdownDivider({ className, style }: DropdownDividerProps) {
  return (
    <div
      aria-hidden="true"
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
  const renderContent = (
    <DropdownContext.Provider value={contextValue}>
      <div
        className={joinClasses('octo-ui-dropdown', overlayClassName)}
        style={overlayStyle}
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
