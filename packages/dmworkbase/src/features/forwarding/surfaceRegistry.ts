import type { ForwardSurfaceItem, ForwardSurfacePort } from "./surfaceContract"

export interface ForwardSurfaceAdapter extends ForwardSurfacePort {
  resolveAvatar?(item: ForwardSurfaceItem): string | undefined
}

let port: ForwardSurfaceAdapter | undefined

/** Installed by the desktop entry before mounting UI; ordinary Web has no remote surface. */
export function installForwardSurfacePort(next: ForwardSurfaceAdapter): () => void {
  const previous = port
  port = next
  return () => {
    if (port === next) port = previous
  }
}

export function getForwardSurfacePort(): ForwardSurfaceAdapter | undefined {
  return port
}
