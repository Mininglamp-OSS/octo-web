import { IconClose } from '@douyinfe/semi-icons'
import SemiSideSheet from '@douyinfe/semi-ui/lib/es/sideSheet'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentRef, KeyboardEvent, MouseEvent, Ref } from 'react'
import type { SideSheetReactProps } from '@douyinfe/semi-ui/lib/es/sideSheet'
import type { DrawerProps, DrawerSize } from './types'

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ')

const widthBySize: Record<DrawerSize, number> = {
  compact: 336,
  default: 480,
  wide: 664,
}

const semiSizeByDrawerSize: Record<DrawerSize, 'small' | 'medium' | 'large'> = {
  compact: 'small',
  default: 'medium',
  wide: 'large',
}

function isVerticalPlacement(placement: DrawerProps['placement']) {
  return placement === 'left' || placement === 'right'
}

const Drawer = forwardRef<ComponentRef<typeof SemiSideSheet> | HTMLElement, DrawerProps>(function Drawer(
  {
    'aria-label': ariaLabel,
    afterClose,
    afterOpenChange,
    bodyClassName,
    bodyFlush = false,
    children,
    className,
    closable = true,
    closeIcon,
    closeLabel = 'Close',
    closeOnEsc = true,
    contentClassName,
    defaultOpen,
    defaultVisible,
    extra,
    footer,
    footerClassName,
    height,
    inline = false,
    keepDOM,
    mask = false,
    maskClosable = true,
    maskStyle,
    motion = true,
    onCancel,
    onClose,
    onOpenChange,
    onVisibleChange,
    open,
    placement = 'right',
    portalContainer,
    size = 'default',
    style,
    title,
    visible,
    width,
    zIndex,
  },
  ref,
) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? defaultVisible ?? false)
  const previousOpenRef = useRef<boolean | undefined>(undefined)
  const controlledOpen = open ?? visible
  const actualOpen = controlledOpen ?? internalOpen
  const drawerWidth = width ?? (isVerticalPlacement(placement) ? widthBySize[size] : undefined)
  const drawerHeight = height ?? (!isVerticalPlacement(placement) ? widthBySize[size] : undefined)

  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(nextOpen)
    }
    onOpenChange?.(nextOpen)
    onVisibleChange?.(nextOpen)
  }, [controlledOpen, onOpenChange, onVisibleChange])

  const handleClose = useCallback((event?: MouseEvent<Element> | KeyboardEvent<Element>) => {
    setOpen(false)
    onClose?.(event)
    onCancel?.(event)
  }, [onCancel, onClose, setOpen])

  const handleVisibleChange = useCallback((nextOpen: boolean) => {
    afterOpenChange?.(nextOpen)
    if (!nextOpen) {
      afterClose?.()
    }
  }, [afterClose, afterOpenChange])

  useEffect(() => {
    if (!inline) return
    if (previousOpenRef.current === actualOpen) return
    previousOpenRef.current = actualOpen
    handleVisibleChange(actualOpen)
  }, [actualOpen, handleVisibleChange, inline])

  useEffect(() => {
    if (!inline || !actualOpen || !closeOnEsc) return
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose(event as unknown as KeyboardEvent<Element>)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [actualOpen, closeOnEsc, handleClose, inline])

  const titleNode = useMemo(() => {
    if (!title && !extra && !closable) return null

    return (
      <header className="octo-ui-drawer__header">
        <div className="octo-ui-drawer__title">{title}</div>
        {extra ? <div className="octo-ui-drawer__extra">{extra}</div> : null}
        {closable ? (
          <button
            aria-label={closeLabel}
            className="octo-ui-drawer__close"
            type="button"
            onClick={handleClose}
          >
            {closeIcon ?? <IconClose size="small" aria-hidden="true" />}
          </button>
        ) : null}
      </header>
    )
  }, [closable, closeIcon, closeLabel, extra, handleClose, title])

  const bodyNode = (
    <div className="octo-ui-drawer__surface">
      {titleNode}
      <div className={cx('octo-ui-drawer__body', bodyFlush && 'octo-ui-drawer__body--flush', bodyClassName)}>
        {children}
      </div>
      {footer ? (
        <footer className={cx('octo-ui-drawer__footer', footerClassName)}>
          {footer}
        </footer>
      ) : null}
    </div>
  )

  if (inline) {
    if (!actualOpen && !keepDOM) return null

    return (
      <aside
        ref={ref as Ref<HTMLElement>}
        aria-hidden={!actualOpen}
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        className={cx('octo-ui-drawer', 'octo-ui-drawer--inline', `octo-ui-drawer--${placement}`, className)}
        data-octo-drawer-open={actualOpen ? 'true' : 'false'}
        data-octo-drawer-placement={placement}
        data-octo-drawer-size={size}
        role="dialog"
        style={{
          height: drawerHeight,
          width: drawerWidth,
          zIndex,
          ...style,
        }}
      >
        <div className={cx('octo-ui-drawer__dialog', contentClassName)}>
          {bodyNode}
        </div>
      </aside>
    )
  }

  const sideSheetProps: SideSheetReactProps & {
    dialogClassName?: string
    'data-octo-drawer-placement': DrawerProps['placement']
    'data-octo-drawer-size': DrawerSize
  } = {
    'aria-label': ariaLabel ?? (typeof title === 'string' ? title : undefined),
    afterVisibleChange: handleVisibleChange,
    bodyStyle: {
      display: 'flex',
      flex: 1,
      minHeight: 0,
      padding: 0,
    },
    className: cx('octo-ui-drawer', `octo-ui-drawer--${placement}`, className),
    closable: false,
    closeOnEsc,
    dialogClassName: cx('octo-ui-drawer__dialog', contentClassName),
    getPopupContainer: portalContainer,
    headerStyle: { display: 'none' },
    height: drawerHeight,
    keepDOM,
    mask,
    maskClosable,
    maskStyle,
    motion,
    onCancel: handleClose,
    placement,
    size: semiSizeByDrawerSize[size],
    style,
    title: null,
    visible: actualOpen,
    width: drawerWidth,
    zIndex,
    'data-octo-drawer-placement': placement,
    'data-octo-drawer-size': size,
  }

  return (
    <SemiSideSheet
      ref={ref as Ref<ComponentRef<typeof SemiSideSheet>>}
      {...sideSheetProps}
    >
      {bodyNode}
    </SemiSideSheet>
  )
})

export default Drawer
export { Drawer }
