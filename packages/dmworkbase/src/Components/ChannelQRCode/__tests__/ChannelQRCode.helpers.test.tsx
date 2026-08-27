// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import ChannelQRCode from "../index"

describe("ChannelQRCode actions", () => {
  it("handles copy success and failure without rendering the provider", async () => {
    const component: any = new ChannelQRCode({ channel: {} as any })
    component.context = { t: (key: string) => key }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    await component.handleCopyLink("https://invite")
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    })
    await expect(component.handleCopyLink("https://invite")).resolves.toBeUndefined()
  })
})
