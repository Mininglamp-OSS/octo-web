import { createPortal } from 'react-dom'

/**
 * A dropdown menu rendered in a body portal at fixed coords, so it is never clipped by an
 * ancestor's `overflow` (the docs list panel scrolls, which was cutting off inline menus).
 * A full-screen transparent backdrop closes it on outside click.
 *
 * Extracted from DocsHome so both the header "new/import" menus and the recent-tab CreatorFilter
 * share one implementation (frontend-design §1.4 / §5.2).
 */
export function PortalMenu({
  at,
  onClose,
  children,
  minWidth = 160,
}: {
  at: { left: number; top: number }
  onClose: () => void
  children: React.ReactNode
  minWidth?: number
}): React.ReactElement {
  return createPortal(
    <>
      <div className="octo-portal-menu-backdrop" onMouseDown={onClose} />
      <div
        role="menu"
        className="octo-portal-menu"
        style={{ left: at.left, top: at.top, minWidth }}
      >
        {children}
      </div>
    </>,
    document.body,
  )
}
