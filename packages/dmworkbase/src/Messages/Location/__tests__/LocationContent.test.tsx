// @vitest-environment jsdom
import React from "react"
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("react-virtuoso", () => ({ Virtuoso: () => null, TableVirtuoso: () => null }))
vi.mock("../../Base", () => ({ default: ({ children }: any) => children }))
vi.mock("../../MessageCell", async () => {
  const React = await import("react")
  return { MessageCell: class extends React.Component<any> {} }
})
vi.mock("../../../App", () => ({ default: { dataSource: { commonDataSource: { getFileURL: (url: string) => url } } } }))

import { LocationCell, LocationContent } from "../index"

describe("Location message content", () => {
  it("decodes fields with safe defaults and exposes a digest", () => {
    const content = new LocationContent()
    content.decodeJSON({ lng: 121.5, lat: 31.2, title: "Office", address: "Road", img: "map.png" })
    expect(content).toMatchObject({ lng: 121.5, lat: 31.2, title: "Office", address: "Road", img: "map.png" })
    content.decodeJSON({})
    expect(content).toMatchObject({ lng: 0, lat: 0, title: "", address: "", img: "" })
    expect(content.conversationDigest).toBeTruthy()
  })

  it("clamps coordinates and opens a map URL when clicked", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null)
    const content: any = { lng: 999, lat: -999, title: "Place", address: "Addr", img: "cover" }
    const { container } = render(<LocationCell message={{ content } as any} context={{} as any} />)
    fireEvent.click(container.querySelector(".wk-message-location")!)
    expect(open).toHaveBeenCalledWith(expect.stringContaining("180_-90"))
    open.mockRestore()
  })
})
