// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }))
vi.mock("../../Base", () => ({ default: ({ children }: any) => children }))
vi.mock("../../MessageCell", () => ({ MessageCell: class { props: any; constructor(props: any) { this.props = props } } }))
vi.mock("../../../App", () => ({ default: { dataSource: { commonDataSource: { getImageURL: (url: string) => `cdn:${url}` } } } }))

import { GifCell, GifContent } from "../index"

describe("Gif message content", () => {
  it("decodes object and double-stringified payloads defensively", () => {
    const content = new GifContent()
    content.decodeJSON({ width: 320, height: 180, url: "gif-url" })
    expect(content).toMatchObject({ width: 320, height: 180, url: "gif-url" })
    content.decodeJSON(JSON.stringify({ width: 10, height: 20, url: "nested" }))
    expect(content).toMatchObject({ width: 10, height: 20, url: "nested" })
    content.decodeJSON("not-json")
    expect(content).toMatchObject({ width: 0, height: 0, url: "" })
    expect(content.conversationDigest).toBeTruthy()
  })

  it("scales landscape, portrait, square and already-small images", () => {
    const cell: any = new (GifCell as any)({})
    expect(cell.imageScale(400, 200, 150, 150)).toEqual({ width: 150, height: 75 })
    expect(cell.imageScale(100, 400, 150, 150)).toEqual({ width: 37.5, height: 150 })
    expect(cell.imageScale(400, 400, 150, 150)).toEqual({ width: 150, height: 150 })
    expect(cell.imageScale(100, 80, 150, 150)).toEqual({ width: 100, height: 80 })
    cell.props = { message: { content: { width: 100, height: 80, url: "gif" } }, context: {} }
    expect(cell.render()).toBeTruthy()
  })
})
