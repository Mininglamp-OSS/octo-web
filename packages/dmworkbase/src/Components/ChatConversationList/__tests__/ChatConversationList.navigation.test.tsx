// @vitest-environment jsdom
import React from "react"
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import WKSDK, { Channel, ChannelInfo, Conversation, ConversationExtra } from "wukongimjssdk"
import ChatConversationList from "../index"
import WKApp from "../../../App"
import { ConversationWrap } from "../../../Service/Model"
import FoldChatService from "../../../Service/FoldChatService"
import { t } from "../../../i18n"

vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
vi.mock("../../WKAvatar", () => ({ default: () => null }))
vi.mock("../../../Service/FoldChatService", () => ({
 default: { list: vi.fn(), set: vi.fn() }, foldKey: (c: {channel_id: string; channel_type: number}) => `${c.channel_type}::${c.channel_id}`,
}))
vi.mock("../../../Hooks/useCategoryList", () => ({ useCategoryList: () => ({
 categories: [], isLoading: false, reload: vi.fn(), createCategory: vi.fn(), renameCategory: vi.fn(), deleteCategory: vi.fn(), sortCategories: vi.fn(), moveGroupToCategory: vi.fn(),
}) }))
vi.mock("../../../Hooks/useFollowSidebar", () => ({ useFollowSidebarContext: () => ({
 dmsByCategory: new Map(), threadsByCategory: new Map(), itemsByCategory: new Map(), followedGroupNos: new Set(), followedKeys: new Set(), versionRef: {current: 0}, bumpVersion: vi.fn(), applyOptimisticSort: vi.fn(), isLoading: false, reload: vi.fn(),
}) }))

const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
beforeEach(() => {
 frames.clear()
 vi.spyOn(WKApp.shared, "currentSpaceId", "get").mockReturnValue("fold-navigation-space")
 vi.mocked(FoldChatService.list).mockResolvedValue([{channel_id: "folded", channel_type: 2}])
 vi.mocked(FoldChatService.set).mockClear()
 vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
 vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function flushFrames() {
 // Drain handoffs as well as the initiating navigation frame.
 for (let n = 0; frames.size && n < 8; n++) {
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(0)) })
 }
 expect(frames.size).toBe(0)
}
function conversation(id: string, unread: number, muted = false) {
 const channel = new Channel(id, 2)
 const info = new ChannelInfo(); info.channel = channel; info.title = id; info.mute = muted; info.orgData = {displayName: id}
 WKSDK.shared().channelManager.setChannleInfoForCache(info)
 const raw = new Conversation(); raw.channel = channel; raw.unread = unread; raw.timestamp = 1; raw.remoteExtra = new ConversationExtra()
 return new ConversationWrap(raw)
}
const actions = { onConversationClick: vi.fn(), onClearMessages: vi.fn(), onThreadOverflowClick: vi.fn() }
const row = (root: HTMLElement, id: string) => root.querySelector(`[data-object-id="${id}"]`)
const target = (root: HTMLElement) => root.querySelector('[class*="wk-conv-unread-num--nudge-"]')?.closest('[data-object-id]')?.getAttribute('data-object-id')

describe("real folded parent/list navigation", () => {
 it.each([false, true])("keeps a manually opened read or muted-only collection visible (muted: %s)", async muted => {
  const chats = [conversation("recent", 1), conversation("folded", muted ? 2 : 0, muted)]
  const screen = render(<ChatConversationList {...actions} conversations={chats} filter="all" scrollToUnreadToken={0} />)
  await waitFor(() => expect(screen.container.querySelector('.wk-folded-entry')).not.toBeNull())
  fireEvent.click(screen.container.querySelector('.wk-folded-entry')!)
  flushFrames()
  expect(row(screen.container, "folded")).not.toBeNull()
  expect(row(screen.container, "recent")).toBeNull()
  expect(target(screen.container)).toBeUndefined()
 })
 it("keeps manual Back to Recent on an all-read Recent list even when Folded has unread", async () => {
  const chats = [conversation("recent", 0), conversation("folded", 1)]
  const screen = render(<ChatConversationList {...actions} conversations={chats} filter="all" scrollToUnreadToken={0} />)
  await waitFor(() => expect(screen.container.querySelector('.wk-folded-entry')).not.toBeNull())
  fireEvent.click(screen.container.querySelector('.wk-folded-entry')!); flushFrames()
  fireEvent.click(screen.getByRole('button', {name: new RegExp(t('base.foldChats.back'))})); flushFrames()
  expect(row(screen.container, "recent")).not.toBeNull()
  expect(row(screen.container, "folded")).toBeNull()
  expect(target(screen.container)).toBeUndefined()
 })
 it("continues explicit unread jumps in both directions, including an emptied folded list", async () => {
  const recent = conversation("recent", 1), folded = conversation("folded", 1)
  const view = (token: number) => <ChatConversationList {...actions} conversations={[recent, folded]} filter="all" scrollToUnreadToken={token} />
  const screen = render(view(0))
  await waitFor(() => expect(screen.container.querySelector('.wk-folded-entry')).not.toBeNull())
  screen.rerender(view(1)); flushFrames(); expect(target(screen.container)).toBe('recent')
  screen.rerender(view(2)); flushFrames(); expect(target(screen.container)).toBe('folded')
  screen.rerender(view(3)); flushFrames(); expect(target(screen.container)).toBe('recent')
  screen.rerender(view(4)); flushFrames(); expect(target(screen.container)).toBe('folded')
  folded.conversation.unread = 0
  screen.rerender(view(5)); flushFrames(); expect(target(screen.container)).toBe('recent')
 })
 it("routes repeated searches to both destinations before acknowledging their scrolls without changing folding", async () => {
  const recent = conversation("recent", 1), folded = conversation("folded", 0), onScrolled = vi.fn()
  const view = (token?: number, chat = folded) => <ChatConversationList {...actions} conversations={[recent, folded]} filter="all" scrollToUnreadToken={0}
   temporaryConversationPresentation={{conversations: [chat], virtualChannelKeys: new Set<string>(), onScrolled, scrollRequest: token === undefined ? undefined : {token, channel: chat.channel}}} />
  const screen = render(view())
  await waitFor(() => expect(screen.container.querySelector('.wk-folded-entry')).not.toBeNull())
  screen.rerender(view(1)); flushFrames()
  expect(row(screen.container, 'folded')).not.toBeNull(); expect(onScrolled).toHaveBeenCalledExactlyOnceWith(1)
  screen.rerender(view(2)); flushFrames(); expect(onScrolled.mock.calls).toEqual([[1],[2]])
  screen.rerender(view(3, recent)); flushFrames()
  expect(row(screen.container, 'recent')).not.toBeNull(); expect(row(screen.container, 'folded')).toBeNull()
  expect(onScrolled.mock.calls).toEqual([[1],[2],[3]])
  expect(FoldChatService.set).not.toHaveBeenCalled()
 })
 it("waits for folded preferences before routing an initial search and does not reroute manual Back", async () => {
  let resolve!: (rows: {channel_id: string; channel_type: number}[]) => void
  vi.mocked(FoldChatService.list).mockReturnValueOnce(new Promise(done => { resolve = done }))
  const recent = conversation('recent', 0), folded = conversation('folded', 1), onScrolled = vi.fn()
  const screen = render(<ChatConversationList {...actions} conversations={[recent, folded]} filter="all" scrollToUnreadToken={0}
   temporaryConversationPresentation={{conversations:[folded], virtualChannelKeys: new Set<string>(), onScrolled, scrollRequest:{token:1, channel:folded.channel}}} />)
  flushFrames(); expect(onScrolled).not.toHaveBeenCalled()
  await act(async () => { resolve([{channel_id:'folded',channel_type:2}]) })
  flushFrames(); expect(row(screen.container,'folded')).not.toBeNull(); expect(onScrolled).toHaveBeenCalledExactlyOnceWith(1)
  fireEvent.click(screen.getByRole('button', {name:new RegExp(t('base.foldChats.back'))})); flushFrames()
  expect(row(screen.container,'recent')).not.toBeNull()
  expect(onScrolled).toHaveBeenCalledTimes(1)
 })
})
