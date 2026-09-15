import { installForwardSurfacePort, type ForwardSurfaceAdapter } from "@octo/base/src/features/forwarding/surfaceRegistry"
import type { OctoBuddyCommunicationBridge } from "./hostBridge"

export function installHostForwardSurface(
  host: OctoBuddyCommunicationBridge,
  resolveAvatar?: ForwardSurfaceAdapter["resolveAvatar"],
): () => void {
  if (!host.publishForwardSurface || !host.onForwardSurfaceAction) return () => {}
  return installForwardSurfacePort({
    resolveAvatar,
    publish: (update) => host.publishForwardSurface!(update),
    subscribe: (listener) => host.onForwardSurfaceAction!(listener),
  })
}
