// @vitest-environment jsdom
import React from "react"
import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const hook = vi.hoisted(() => ({
  useCodeRenderer: vi.fn(() => ({ loading: false, error: null, reload: vi.fn(), renderMode: "plain", formattedContent: "{}", fileSize: 2, contentSize: 2 })),
}))
vi.mock("../useCodeRenderer", () => hook)
vi.mock("../CodeRendererBase", () => ({ default: (props: any) => <div data-testid="code" data-language={props.language}>{props.formattedContent}</div> }))

import JsonRenderer from "../JsonRenderer"
import TextRenderer from "../TextRenderer"

describe("code renderers", () => {
  it("passes JSON renderer options to the shared code hook", () => {
    render(<JsonRenderer file={{ url: "/a.json", name: "a.json", extension: "json", size: 2 }} />)
    expect(hook.useCodeRenderer).toHaveBeenCalledWith(expect.objectContaining({ extension: "json" }), expect.objectContaining({ language: "json", enableHighlight: true, formatter: expect.any(Function) }))
    const options = hook.useCodeRenderer.mock.calls.at(-1)?.[1]
    expect(options.formatter('{"a":1}')).toContain('"a": 1')
    expect(options.formatter("not json")).toBe("not json")
  })

  it("passes text renderer options and shared state through", () => {
    render(<TextRenderer file={{ url: "/a.txt", name: "a.txt", extension: "txt", size: 2 }} />)
    expect(hook.useCodeRenderer).toHaveBeenCalledWith(expect.objectContaining({ extension: "txt" }), expect.objectContaining({ language: "text", enableHighlight: false }))
  })
})
