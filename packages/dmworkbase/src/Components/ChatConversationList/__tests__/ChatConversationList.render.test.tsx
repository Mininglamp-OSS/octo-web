// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))

const captured = vi.hoisted(() => ({ list: null as any, grouped: null as any, modal: null as any }))
const categoryState: any = {
  categories: [{ id: "c1", name: "Work" }], isLoading: false, error: undefined,
  reload: vi.fn(), createCategory: vi.fn(), renameCategory: vi.fn(), deleteCategory: vi.fn(), sortCategories: vi.fn(), moveGroupToCategory: vi.fn(),
}
const sidebarState: any = {
  dmsByCategory: new Map(), threadsByCategory: new Map(), itemsByCategory: new Map(), followedGroupNos: new Set(), followedKeys: new Set(), versionRef: { current: 1 }, bumpVersion: vi.fn(), applyOptimisticSort: vi.fn(), isLoading: false, error: undefined, reload: vi.fn(), reloadSidebar: vi.fn(),
}
vi.mock("../../../Hooks/useCategoryList", () => ({ useCategoryList: () => categoryState }))
vi.mock("../../../Hooks/useFollowSidebar", () => ({ useFollowSidebarContext: () => sidebarState }))
vi.mock("../../ConversationList", () => ({ default: (p: any) => { captured.list = p; return <button data-testid="conversation-list" onClick={() => p.onConversationClick?.({})}>list</button> } }))
vi.mock("../../ConversationListGrouped", () => ({ default: (p: any) => { captured.grouped = p; return <button data-testid="grouped-list" onClick={() => p.onOpenCreateCategory?.()}>grouped</button> }, isValidCategoryItem: () => true }))
vi.mock("../../CreateCategoryModal", () => ({ default: (p: any) => { captured.modal = p; return <div data-testid="create-modal">{String(p.visible)}</div> } }))
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), t: (key: string) => key, I18nContext: React.createContext({}) }))

import ChatConversationList from "../index"

describe("ChatConversationList render branches", () => {
  it("renders recent and grouped sources, loading/error states, and external create ref", async () => {
    const ref: any = { current: null }
    const props: any = { conversations: [], filter: "all", onConversationClick: vi.fn(), onClearMessages: vi.fn(), onThreadOverflowClick: vi.fn(), onOpenCreateCategoryRef: ref, onGroupCreated: vi.fn() }
    const { rerender } = render(<ChatConversationList {...props} />)
    expect(document.querySelector("[data-testid=conversation-list]")).toBeInTheDocument()
    captured.list.shouldScrollToUnreadTarget?.({ unread: 1, channel: { channelID: "u", channelType: 1 } })
    captured.list.extraContextMenus?.(undefined)
    ref.current?.()
    expect(document.querySelector("[data-testid=create-modal]")?.textContent).toBe("true")
    categoryState.createCategory.mockResolvedValueOnce({ category_id: "new" })
    await captured.modal.onConfirm("New")
    rerender(<ChatConversationList {...props} filter="group" />)
    expect(document.querySelector("[data-testid=grouped-list]")).toBeInTheDocument()
    captured.grouped.onOpenCreateCategory?.({ kind: "moveGroupToNewCategory", groupNo: "g" })
    await captured.grouped.onDeleteCategory?.("c1")
    await captured.grouped.onMoveGroupToCategory?.("g", "c1")
    captured.grouped.onRenameCategory?.("c1", "Renamed")
    captured.grouped.onSortCategories?.([])
    captured.grouped.onRetry?.()
    captured.grouped.onUnfollow?.()
    captured.modal.onCancel?.()
    categoryState.isLoading = true; sidebarState.isLoading = true
    rerender(<ChatConversationList {...props} filter="group" />)
    categoryState.isLoading = false; sidebarState.isLoading = false; categoryState.error = "failed"
    rerender(<ChatConversationList {...props} filter="group" />)
    categoryState.error = undefined
  })
})
