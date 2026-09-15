import { Channel } from "wukongimjssdk"
import WKApp from "@octo/base/src/App"
import type { ForwardSurfaceItem } from "@octo/base/src/features/forwarding/surfaceContract"

export function resolveForwardSurfaceAvatar(item: ForwardSurfaceItem): string | undefined {
  const url = WKApp.shared.avatarChannel(new Channel(item.channelID, item.channelType))
  try {
    const resolved = new URL(url, window.location.href)
    return ["https:", "http:"].includes(resolved.protocol) ? resolved.href : undefined
  } catch {
    return undefined
  }
}
