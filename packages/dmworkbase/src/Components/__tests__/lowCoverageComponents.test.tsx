// @vitest-environment jsdom
import React from "react"
import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../Messages/Base", () => ({ default: ({ children }: any) => <>{children}</> }))
import ActionListItem from "../ActionListItem"
import AddCategoryButton from "../AddCategoryButton"
import AttachmentPreview from "../AttachmentPreview"
import ConversationListWithCategory from "../ConversationListWithCategory"
import MoveToGroupMenu from "../MoveToGroupMenu"
import CategoryEmptyState from "../CategoryEmptyState"
import CategoryHeader from "../CategoryHeader"
import { Checkbox } from "@octo/ui"
import IconListItem from "../IconListItem"
import ViewToggle from "../ViewToggle"
import Bubble from "../../ui/message/Bubble"
import SystemMessage from "../../ui/message/SystemMessage"
import ThreadBadge from "../../ui/message/ThreadBadge"
import Timestamp from "../../ui/message/Timestamp"
import APIClient from "../../Service/APIClient"
import { getDocument } from "../../Service/DocumentService"
import { updateUserLanguagePreference } from "../../Service/UserLanguageService"
import { getQueryParam } from "../../Utils/search"
import ConnectionStatus from "../ConnectionStatus"
import SpaceAvatar from "../SpaceAvatar"
import SpaceItem from "../SpaceItem"
import { ChannelQRCodeVM } from "../ChannelQRCode/vm"
import ThreadParent from "../../ui/message/ThreadParent"
import { SystemCell } from "../../Messages/System"
import { UnknownCell } from "../../Messages/Unknown"
import { UnsupportCell, UnsupportContent } from "../../Messages/Unsupport"
import { FlameMessageCell } from "../../Messages/Flame"
import { SignalMessageCell, SignalMessageContent } from "../../Messages/SignalMessage/signalmessage"
import { VideoContent, VideoCell } from "../../Messages/Video"
import { VoiceContent } from "../../Messages/Voice"
import { MessageContentTypeConst } from "../../Service/Const"
import { Channel } from "wukongimjssdk"

describe("small base UI components", () => {
  it("renders action variants and invokes the action", () => {
    const onClick = vi.fn()
    const { rerender, getByRole, getByText } = render(
      <ActionListItem icon={<span>i</span>} label="Join" desc="detail" trailing="->" onClick={onClick} variant="join" />,
    )
    fireEvent.click(getByRole("button"))
    expect(onClick).toHaveBeenCalledOnce()
    expect(getByText("detail")).toBeTruthy()
    rerender(<ActionListItem icon={null} label="Create" variant="create" compact />)
    expect(getByRole("button").className).toContain("compact")
  })

  it("renders category actions and handles callbacks", () => {
    const create = vi.fn()
    const select = vi.fn()
    const { getByText, rerender } = render(<AddCategoryButton onClick={create} />)
    fireEvent.click(getByText("+"))
    expect(create).toHaveBeenCalledOnce()
    rerender(<MoveToGroupMenu categories={[{ id: "a", name: "A" }]} onSelect={select} onCreateNew={create} />)
    fireEvent.click(getByText("A"))
    fireEvent.click(getByText("新建分组"))
    expect(select).toHaveBeenCalledWith("a")
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("covers attachment file icon and size branches plus removal", () => {
    const remove = vi.fn()
    const files = ["movie.mp4", "x.gif", "x.pdf", "x.docx", "x.xlsx", "x.zip", "plain.txt"].map((name, i) =>
      new File([new Uint8Array((i + 1) * 1024)], name, { type: name.endsWith("mp4") ? "video/mp4" : "" }),
    )
    const { container, getAllByTitle } = render(<AttachmentPreview conversationContext={{ removePendingAttachment: remove } as any} files={files} />)
    expect(container.querySelectorAll("img")).toHaveLength(files.length)
    getAllByTitle("移除").forEach((button) => fireEvent.click(button))
    expect(remove).toHaveBeenCalledTimes(files.length)
    expect(render(<AttachmentPreview conversationContext={{} as any} files={[]} />).container.firstChild).toBeNull()
  })

  it("covers category list loading, error, empty, and populated states", () => {
    const retry = vi.fn()
    const create = vi.fn()
    const { container, rerender, getByRole } = render(<ConversationListWithCategory isLoading onRetry={retry} />)
    expect(container.querySelectorAll(".wk-conv-with-category__skeleton")).toHaveLength(4)
    rerender(<ConversationListWithCategory error="bad" onRetry={retry} />)
    fireEvent.click(getByRole("button"))
    expect(retry).toHaveBeenCalledOnce()
    rerender(<ConversationListWithCategory categories={[]} onCreateCategory={create} hasNoGroups onStartGroup={create} />)
    rerender(<ConversationListWithCategory categories={[{ id: "a", name: "A", groupCount: 1, conversations: <span>conversation</span>, hasManagementMenu: true }]} onCategoryContextMenu={create as any} categorySectionDraggable />)
    expect(container.textContent).toContain("conversation")
  })

  it("covers empty-state, checkbox keyboard, header, and icon-list interactions", () => {
    const create = vi.fn()
    const start = vi.fn()
    const toggle = vi.fn()
    const rename = vi.fn()
    const { rerender, getByRole, getByText } = render(<CategoryEmptyState onCreateCategory={create} />)
    fireEvent.click(getByRole("button"))
    expect(create).toHaveBeenCalledOnce()
    rerender(<CategoryEmptyState onCreateCategory={create} noGroups onStartGroup={start} />)
    fireEvent.click(getByRole("button"))
    expect(start).toHaveBeenCalledOnce()
    rerender(<Checkbox checked onChange={create}>label</Checkbox>)
    fireEvent.keyDown(getByRole("checkbox"), { key: "Enter" })
    fireEvent.click(getByRole("checkbox"))
    rerender(<Checkbox onCheck={start} disabled ariaLabel="disabled" />)
    fireEvent.click(getByRole("checkbox"))
    rerender(<CategoryHeader name="Inbox" groupCount={2} unreadCount={3} hasMention isCollapsed={false} onToggle={toggle} isActive onContextMenu={toggle as any} onMoreClick={toggle as any} />)
    fireEvent.click(getByText("Inbox"))
    fireEvent.contextMenu(getByText("Inbox"))
    expect(toggle).toHaveBeenCalled()
    rerender(<CategoryHeader name="Old" isCollapsed onToggle={toggle} isEditing onRenameConfirm={rename} onRenameCancel={start} />)
    const input = getByRole("textbox")
    fireEvent.change(input, { target: { value: "New" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(rename).toHaveBeenCalledWith("New")
    rerender(<IconListItem icon="icon" title="Item" badge={2} onClick={create} />)
    fireEvent.click(getByText("Item"))
    expect(create).toHaveBeenCalled()
  })

  it("covers the small message presentation primitives", () => {
    const change = vi.fn()
    const close = vi.fn()
    const { container, getByRole, getByText, rerender } = render(<ViewToggle value="all" onChange={change} />)
    fireEvent.click(getByRole("button", { name: /分组/ }))
    expect(change).toHaveBeenCalledWith("grouped")
    rerender(<Bubble position="first" isSend><span>body</span></Bubble>)
    expect(container.firstChild?.textContent).toBe("body")
    rerender(<SystemMessage type="revoke" text="revoked" closable onClose={close} />)
    expect(getByText("revoked")).toBeTruthy()
    const closeButton = container.querySelector("button")
    if (closeButton) fireEvent.click(closeButton)
    expect(close).toHaveBeenCalled()
    rerender(<ThreadBadge replyCount={5} participants={[1, 2, 3, 4, 5].map(i => ({ uid: String(i), avatarUrl: `a${i}` }))} lastReplyTime="now" onClick={change} />)
    fireEvent.click(container.firstChild as Element)
    expect(getByText("+1")).toBeTruthy()
    rerender(<Timestamp time="1700000000" format="YYYY" />)
    expect(container.textContent).toBe("2023")
  })

  it("covers the thin service and query helpers", async () => {
    const get = vi.spyOn(APIClient.shared, "get").mockResolvedValue({ title: "Doc" } as any)
    const put = vi.spyOn(APIClient.shared, "put").mockResolvedValue({ ok: true } as any)
    await expect(getDocument("guide")).resolves.toEqual({ title: "Doc" })
    await expect(updateUserLanguagePreference("zh-CN" as any)).resolves.toEqual({ ok: true })
    expect(get).toHaveBeenCalledWith("/voice/document/guide")
    expect(put).toHaveBeenCalledWith("/user/language", { language: "zh-CN" })
    window.history.replaceState({}, "", "/?q=hello")
    expect(getQueryParam("q")).toBe("hello")
    expect(getQueryParam("missing")).toBeNull()
    get.mockRestore()
    put.mockRestore()
  })

  it("covers connection signal formatting and state transitions", () => {
    const view: any = new (ConnectionStatus as any)({ compact: true })
    expect(view.getLatencyColor(50)).toBe("#22c55e")
    expect(view.getLatencyColor(200)).toBe("#eab308")
    expect(view.getLatencyColor(500)).toBe("#ef4444")
    expect(view.getSignalBars(null, false)).toBe(0)
    expect(view.getSignalBars(null, true)).toBe(2)
    expect(view.getSignalBars(50, true)).toBe(3)
    expect(view.getSignalBars(200, true)).toBe(2)
    expect(view.getSignalBars(500, true)).toBe(1)
    const t = (key: string) => key
    expect(view.formatDuration(null, t)).toBe("")
    expect(view.formatDuration(Date.now(), t)).toContain("seconds")
    expect(view.formatDuration(Date.now() - 120000, t)).toContain("minutes")
    expect(view.formatDuration(Date.now() - 7200000, t)).toContain("hoursMinutes")
    view.setState = vi.fn()
    view.stopPing()
  })

  it("covers space avatar and keyboard selection", () => {
    const click = vi.fn()
    const { container, getByRole, getByText, rerender } = render(<SpaceAvatar name="Alpha" />)
    expect(container.textContent).toBe("A")
    rerender(<SpaceAvatar name="Alpha" logo="logo.png" size="lg" />)
    expect(container.querySelector("img")).toBeTruthy()
    rerender(<SpaceItem name="Space" meta="3 members" selected actions={<span>action</span>} onClick={click} />)
    fireEvent.keyDown(getByRole("button"), { key: "Enter" })
    fireEvent.keyDown(getByRole("button"), { key: " " })
    expect(click).toHaveBeenCalledTimes(2)
    expect(getByText("3 members")).toBeTruthy()
  })

  it("loads channel QR data and renders the thread parent shell", async () => {
    const qrcode = vi.fn().mockResolvedValue({ qrcode: "qr", expire: 60 })
    const app = (await import("../../App")).default as any
    const old = app.dataSource.channelDataSource
    app.dataSource.channelDataSource = { qrcode }
    const vm = new ChannelQRCodeVM({ channelID: "g", channelType: 2 } as any)
    ;(vm as any).notifyListener = vi.fn()
    await vm.requestQRCode()
    expect(vm.qrcodeResp?.qrcode).toBe("qr")
    app.dataSource.channelDataSource = old
    const { getByText } = render(<ThreadParent replyCount={1} participants={[]} lastReplyTime="now"><span>message</span></ThreadParent>)
    expect(getByText("message")).toBeTruthy()
  })

  it("covers the remaining tiny message cells and content fallbacks", () => {
    const context: any = {}
    const message: any = { channel: new Channel("group", 2), fromUID: "sender", send: false, content: { displayText: "system", realContentType: 999 } }
    expect(render(new SystemCell({ message, context } as any).render() as any).container.textContent).toContain("system")
    expect(render(new UnknownCell({ message, context } as any).render() as any).container.textContent).toContain("不支持")
    expect(render(new UnsupportCell({ message, context } as any).render() as any).container.textContent).toContain("不支持")
    expect(render(new FlameMessageCell({ message, context } as any).render() as any).container.firstChild).toBeTruthy()
    expect(render(new SignalMessageCell({ message, context } as any).render() as any).container.firstChild).toBeTruthy()
    expect(new UnsupportContent().conversationDigest).toBeTruthy()
    expect(new SignalMessageContent().conversationDigest).toBeTruthy()
  })

  it("covers media content normalization and video duration formatting", () => {
    const video = new VideoContent()
    video.decodeJSON({ url: "u", cover: "c", size: 2, width: 3, height: 4, second: 65 })
    expect(video.encodeJSON()).toEqual({ url: "u", cover: "c", size: 2, width: 3, height: 4, second: 65 })
    expect(video.conversationDigest).toBeTruthy()
    const voice = new VoiceContent()
    voice.decodeJSON({ url: "v", timeTrad: 4, waveform: "w" })
    expect(voice.url).toBe("v")
    const cell: any = new (VideoCell as any)({ message: { content: {} }, context: {} })
    expect(cell.secondFormat(65)).toBe("01:05")
    expect(cell.secondFormat(5)).toBe("00:05")
  })
})
