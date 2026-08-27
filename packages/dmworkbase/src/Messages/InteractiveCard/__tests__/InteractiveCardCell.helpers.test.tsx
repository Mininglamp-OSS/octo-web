// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import InteractiveCardCell from "../InteractiveCardCell"

describe("InteractiveCardCell rendering guards", () => {
  it("renders plain, hint, readonly-card, and error bodies", () => {
    const cell: any = new InteractiveCardCell({
      message: { message: {}, content: { plain: "hello\nworld" } },
      context: { editOn: () => false },
    } as any)
    expect(cell.renderBody({ kind: "plain" }, "hello\nworld", "p", false)).toBeTruthy()
    expect(cell.renderBody({ kind: "hint" }, "needs update", "h", true)).toBeTruthy()
    cell.submitError = "failed"
    expect(cell.renderBody({ kind: "card", renderProfile: "octo", interactive: false }, "", "c", false)).toBeTruthy()
    cell.componentWillUnmount()
  })

  it("handles supported actions for a non-interactive card", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const cell: any = new InteractiveCardCell({
      message: { fromUID: "u", channel: { channelID: "g", channelType: 2 }, content: { plain: "x" } },
      context: { editOn: () => false, openWebhookPreview: vi.fn() },
    } as any)
    const card: any = { getAllInputs: () => [] }
    expect(cell.computeState().plain).toBe("x")
    expect(cell.computeState().decision.kind).toBe("plain")

    cell.handleCardAction({ getJsonTypeName: () => "Action.CopyToClipboard", text: "copy", id: "a" }, card)
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith("copy")

    const scheduleEnhance = vi.spyOn(cell, "scheduleEnhanceMountedCard")
    cell.handleCardAction({ getJsonTypeName: () => "Action.ToggleVisibility" }, card)
    expect(scheduleEnhance).toHaveBeenCalledOnce()

    const performSubmit = vi.spyOn(cell, "performSubmit")
    cell.handleCardAction({ getJsonTypeName: () => "Action.Submit", id: "a" }, card)
    expect(performSubmit).not.toHaveBeenCalled()
    expect(() => cell.handleCardAction({ getJsonTypeName: () => "Action.Unknown" }, card)).not.toThrow()
    cell.clearSubmitTimer()
  })

  it("covers lifecycle, card fingerprint, table copy, and timeout cleanup", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    const cell: any = new InteractiveCardCell({
      message: { fromUID: "u", channel: { channelID: "g", channelType: 2 }, content: { plain: "x", conversationDigest: "digest" }, remoteExtra: {} },
      context: { editOn: () => false },
    } as any)
    cell.forceUpdate = vi.fn()
    cell.componentDidMount()
    expect(cell.computeState().plain).toBe("x")
    cell.handleTableCopy("table")
    expect(writeText).toHaveBeenCalledWith("table")
    cell.scheduleEnhanceMountedCard()
    cell.armSubmitTimer(1)
    cell.clearSubmitTimer()
    cell.componentDidUpdate()
    cell.componentWillUnmount()
    await Promise.resolve()
    expect(cell.mounted).toBe(false)
  })
})
