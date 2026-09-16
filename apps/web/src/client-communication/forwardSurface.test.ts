import { afterEach, describe, expect, it, vi } from "vitest"
import { getForwardSurfacePort } from "@octo/base/src/features/forwarding/surfaceRegistry"
import { installHostForwardSurface } from "./forwardSurface"
import type { OctoBuddyCommunicationBridge } from "./hostBridge"

let dispose = () => {}
afterEach(() => dispose())

describe("desktop forwarding surface capability", () => {
  it("leaves ordinary Web and older hosts on the existing local modal path", () => {
    dispose = installHostForwardSurface({} as OctoBuddyCommunicationBridge)
    expect(getForwardSurfacePort()).toBeUndefined()
  })

  it("installs the limited port and restores it on shutdown", async () => {
    const publishForwardSurface = vi.fn().mockResolvedValue(undefined)
    const onForwardSurfaceAction = vi.fn().mockReturnValue(vi.fn())
    dispose = installHostForwardSurface({ publishForwardSurface, onForwardSurfaceAction } as unknown as OctoBuddyCommunicationBridge)
    const port = getForwardSurfacePort()!
    const update = { version: 1, id: "picker", revision: 1, model: null } as const
    await port.publish(update)
    const listener = vi.fn()
    port.subscribe(listener)
    expect(publishForwardSurface).toHaveBeenCalledWith(update)
    expect(onForwardSurfaceAction).toHaveBeenCalledWith(listener)
    dispose()
    expect(getForwardSurfacePort()).toBeUndefined()
  })
})
