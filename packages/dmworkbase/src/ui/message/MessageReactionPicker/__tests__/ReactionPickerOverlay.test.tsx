// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pickerState = vi.hoisted(() => ({ props: undefined as any }))

// 轻量 stub 掉重依赖，聚焦 overlay 的命令式生命周期（容器/监听/焦点/定位）。
vi.mock("../../../../App", () => ({
  default: { loginInfo: { uid: "me" } },
  __esModule: true,
}))
vi.mock("../../MessageReactionSummary/mockStore", () => ({
  reactionMockStore: { get: () => [], toggle: vi.fn() },
  MOCK_REACTION_EVENT: "message-reaction-mock-updated",
}))
// picker / 完整面板都 stub 成简单节点，避免拉入 EmojiPanel(tgs-player) 等重依赖。
vi.mock("../index", () => ({
  default: (props: any) => {
    pickerState.props = props
    return null
  },
  __esModule: true,
}))
vi.mock("../../../../Components/EmojiToolbar", () => ({
  EmojiPanel: () => null,
}))
vi.mock("../../../../i18n", () => ({ t: (k: string) => k }))

import {
  reactionPickerOverlay,
  enablePointerTracking,
  disablePointerTracking,
} from "../ReactionPickerOverlay"

const ROOT = ".wk-msg-reaction-picker-overlay-root"
const roots = () => document.querySelectorAll(ROOT)
const options = (overrides: Record<string, unknown> = {}) => ({
  x: 10,
  y: 200,
  messageId: "m1",
  selectedKeys: [] as string[],
  onSelect: vi.fn(),
  ...overrides,
})

beforeEach(() => {
  pickerState.props = undefined
})

afterEach(() => {
  reactionPickerOverlay.close()
  disablePointerTracking()
  document.body.innerHTML = ""
})

describe("ReactionPickerOverlay lifecycle", () => {
  it("open() mounts one overlay container; close() removes it", () => {
    reactionPickerOverlay.open(options())
    expect(roots()).toHaveLength(1)
    reactionPickerOverlay.close()
    expect(roots()).toHaveLength(0)
  })

  it("repeated open() never leaks multiple containers", () => {
    reactionPickerOverlay.open(options({ x: 10 }))
    reactionPickerOverlay.open(options({ x: 20 }))
    reactionPickerOverlay.open(options({ x: 30 }))
    expect(roots()).toHaveLength(1)
  })

  it("Escape closes the overlay and the keydown listener is gone afterwards", () => {
    reactionPickerOverlay.open(options())
    expect(roots()).toHaveLength(1)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(roots()).toHaveLength(0)
    // 关闭后再按 Escape 不应抛错（监听已拆除）
    expect(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    ).not.toThrow()
  })

  it("close() restores focus to the element focused before open()", () => {
    const btn = document.createElement("button")
    document.body.appendChild(btn)
    btn.focus()
    expect(document.activeElement).toBe(btn)

    reactionPickerOverlay.open(options())
    reactionPickerOverlay.close()
    expect(document.activeElement).toBe(btn)
  })

  it("enablePointerTracking is idempotent and feeds openAtLastPointer", () => {
    enablePointerTracking()
    enablePointerTracking() // 第二次无副作用（幂等）
    document.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 123, clientY: 456 }),
    )
    reactionPickerOverlay.openAtLastPointer(options({ x: undefined, y: undefined }))
    const root = document.querySelector(ROOT) as HTMLElement
    expect(root).not.toBeNull()
    // picker 定位浮层的内联 left 会夹到视口内，但应反映记录到的 x（此处视口足够宽）
    const positioned = root.querySelector<HTMLElement>('[style*="left"]')
    expect(positioned?.style.left).toBe("123px")
  })

  it("disablePointerTracking stops recording pointer position", () => {
    enablePointerTracking()
    document.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 100, clientY: 100 }),
    )
    disablePointerTracking()
    // 拆除后的移动不应再被记录
    document.dispatchEvent(
      new MouseEvent("mousedown", { clientX: 700, clientY: 700 }),
    )
    reactionPickerOverlay.openAtLastPointer(options({ x: undefined, y: undefined }))
    const root = document.querySelector(ROOT) as HTMLElement
    const positioned = root.querySelector<HTMLElement>('[style*="left"]')
    expect(positioned?.style.left).toBe("100px")
  })

  it("uses caller-provided selected keys and delegates quick-pick writes", () => {
    const onSelect = vi.fn()
    reactionPickerOverlay.open(
      options({ selectedKeys: ["👍", "[收到]"], onSelect }),
    )

    expect(pickerState.props.selectedKeys).toEqual(["👍", "[收到]"])
    pickerState.props.onSelect({ key: "thumb", char: "👍" })
    expect(onSelect).toHaveBeenCalledWith("👍")
  })
})
