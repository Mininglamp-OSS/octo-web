export interface BoardCommentOverlayBounds {
  left: number
  top: number
  right: number
  bottom: number
}


export interface BoardCommentOverlayRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Derive the interaction-safe region from the actual panel geometry. Desktop properties occupy a
 * vertical edge; compact/mobile properties may occupy a horizontal edge. Ignore floating islands
 * that are not edge strips so a transient popup cannot collapse the comment surface. */
export function deriveBoardCommentOverlayBounds(
  host: BoardCommentOverlayRect,
  panel?: BoardCommentOverlayRect | null,
): BoardCommentOverlayBounds {
  const bounds: BoardCommentOverlayBounds = { left: 0, top: 0, right: host.width, bottom: host.height }
  if (!panel || panel.right <= host.left || panel.left >= host.right || panel.bottom <= host.top || panel.top >= host.bottom) {
    return bounds
  }
  const relativeLeft = Math.max(0, panel.left - host.left)
  const relativeTop = Math.max(0, panel.top - host.top)
  const relativeRight = Math.min(host.width, panel.right - host.left)
  const relativeBottom = Math.min(host.height, panel.bottom - host.top)
  const width = Math.max(0, relativeRight - relativeLeft)
  const height = Math.max(0, relativeBottom - relativeTop)

  if (width <= host.width / 2 && height >= host.height / 3) {
    if (relativeLeft <= host.width - relativeRight) bounds.left = relativeRight
    else bounds.right = relativeLeft
  } else if (height <= host.height / 2 && width >= host.width / 3) {
    if (relativeTop <= host.height - relativeBottom) bounds.top = relativeBottom
    else bounds.bottom = relativeTop
  }
  return bounds
}

/** Keep an overlay rectangle wholly inside the interaction-safe canvas area. */
export function clampBoardCommentOverlay(
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: BoardCommentOverlayBounds,
  gap = 8,
): { left: number; top: number } {
  const minLeft = bounds.left + gap
  const minTop = bounds.top + gap
  const maxLeft = Math.max(minLeft, bounds.right - width - gap)
  const maxTop = Math.max(minTop, bounds.bottom - height - gap)
  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  }
}

/** Marker centres need half their hit target inside the safe area. */
export function clampBoardCommentMarker(
  x: number,
  y: number,
  bounds: BoardCommentOverlayBounds,
  radius = 12,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, bounds.left + radius), Math.max(bounds.left + radius, bounds.right - radius)),
    y: Math.min(Math.max(y, bounds.top + radius), Math.max(bounds.top + radius, bounds.bottom - radius)),
  }
}
