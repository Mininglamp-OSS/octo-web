// Keep aligned with --octo-doc-drawer-width and its board.css fallback.
export const BOARD_DRAWER_WIDTH = 360
const EXCALIDRAW_DESKTOP_MIN_WIDTH = 730
const EXCALIDRAW_SHORT_DESKTOP_MIN_WIDTH = 1000
const EXCALIDRAW_SHORT_HEIGHT = 500

/** Reserve the drawer only when the remaining Excalidraw viewport stays in its desktop layout. */
export function canReserveBoardDrawer(width: number, height: number): boolean {
  const minimumCanvasWidth = height < EXCALIDRAW_SHORT_HEIGHT
    ? EXCALIDRAW_SHORT_DESKTOP_MIN_WIDTH
    : EXCALIDRAW_DESKTOP_MIN_WIDTH
  return width - BOARD_DRAWER_WIDTH >= minimumCanvasWidth
}
