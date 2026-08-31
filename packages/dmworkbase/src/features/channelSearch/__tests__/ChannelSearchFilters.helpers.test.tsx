// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("@douyinfe/semi-ui", () => ({ DatePicker: ({ triggerRender, onChange }: any) => <div><button type="button" onClick={() => onChange?.(new Date())}>{triggerRender?.()}</button></div> }))
import { ChannelSearchFilterPopover } from "../ChannelSearchFilters"

describe("ChannelSearchFilterPopover", () => {
  it("applies sender, sort, date, and reset interactions", () => {
    const onApply = vi.fn(), onClose = vi.fn()
    const sender = { uid: "u1", name: "Alice", avatarUrl: "avatar" }
    const dataSource: any = {
      getSenders: () => [sender], getSender: () => sender,
      searchSenders: vi.fn().mockResolvedValue([sender]),
    }
    const filters: any = { senderUids: [], sort: "relevance", datePreset: undefined }
    render(<ChannelSearchFilterPopover open filters={filters} dataSource={dataSource} onApply={onApply} onClose={onClose} />)
    fireEvent.click(screen.getByText("最近7天"))
    fireEvent.click(screen.getByText("最近30天"))
    const inputs = screen.getAllByRole("textbox")
    if (inputs[0]) fireEvent.change(inputs[0], { target: { value: "Ali" } })
    const buttons = screen.getAllByRole("button")
    buttons.slice(0, 3).forEach((button) => fireEvent.click(button))
    const ok = screen.getByText("确定")
    fireEvent.click(ok)
    expect(onApply).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
