import React from "react"
import { describe, expect, it, vi } from "vitest"
vi.mock("../../MessageRow", () => ({ default: (props: any) => <div data-kind="row">{props.children}</div> }))
vi.mock("../../TextContent", () => ({ default: () => <span>text</span> }))
vi.mock("../../ThreadParent", () => ({ default: (props: any) => <div>thread{props.children}</div> }))
vi.mock("../../ImageContent/SingleImage", () => ({ default: () => <span>single</span> }))
vi.mock("../../ImageContent/MultiImage", () => ({ default: () => <span>multi</span> }))
vi.mock("../../SystemMessage", () => ({ default: () => <span>system</span> }))
import Message from "../index"

describe("Message UI dispatcher", () => {
  it("routes all supported message content variants", () => {
    const row: any = { id: "row" }
    expect(Message({ type: "system", system: {} as any })).toBeTruthy()
    expect(Message({ type: "text" })).toBeNull()
    expect(Message({ type: "text", row, text: {} as any })).toBeTruthy()
    expect(Message({ type: "thread", row, thread: {} as any, text: {} as any })).toBeTruthy()
    expect(Message({ type: "image", row, singleImage: {} as any })).toBeTruthy()
    expect(Message({ type: "image", row, multiImage: {} as any })).toBeTruthy()
    expect(Message({ type: "image", row })).toBeTruthy()
  })
})
