// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import BotDetailView from "../index"

describe("BotDetailView rendering branches", () => {
  it("renders loading and friend actions", () => {
    const props: any = makeProps({ loading: true })
    const { rerender } = render(<BotDetailView {...props} />)
    expect(document.querySelector(".wk-bot-detail-loading")).toBeTruthy()
    rerender(<BotDetailView {...makeProps({ loading: false, isFriend: true })} />)
    fireEvent.click(screen.getByText("sendMessage"))
    expect(props.onChat).not.toHaveBeenCalled()
    rerender(<BotDetailView {...makeProps({
      loading: false, isFriend: false, showApplyInput: true, applyRemark: "apply",
      editingRemark: true, editingDescription: true, remarkDraft: "draft",
      descriptionDraft: "desc", commands: [{ cmd: "/help", remark: "help" }],
      reported: true, isOwner: true,
    })} />)
    fireEvent.click(screen.getByText("applySend"))
    fireEvent.click(screen.getAllByText("cancel")[0])
    expect(screen.getByText("/help")).toBeTruthy()
  })
})

function makeProps(overrides: any = {}) {
  const labels = new Proxy({}, { get: (_target, key) => String(key) })
  return {
    loading: false, displayName: "Bot", botName: "Bot", username: "bot",
    remark: "Remark", displayDescription: "Description", creatorName: "Creator", commands: [],
    isOwner: true, isFriend: false, reported: false, channelInfo: { online: 1, title: "Bot" },
    uploadingAvatar: false, editingRemark: false, remarkDraft: "", savingRemark: false,
    editingDescription: false, descriptionDraft: "", savingDescription: false,
    showApplyInput: false, applyRemark: "", applying: false, ownerAvatar: <span>owner</span>,
    previewAvatar: <span>avatar</span>, fileInputRef: React.createRef(), descriptionRef: React.createRef(), labels,
    onClose: vi.fn(), onAvatarClick: vi.fn(), onAvatarKeyDown: vi.fn(), onAvatarInputClick: vi.fn(),
    onAvatarFileChange: vi.fn(), onRemarkDraftChange: vi.fn(), onStartEditRemark: vi.fn(), onEditRemarkKeyDown: vi.fn(),
    onCancelEditRemark: vi.fn(), onSaveRemark: vi.fn(), onStartEditDescription: vi.fn(), onEditDescriptionKeyDown: vi.fn(),
    onDescriptionDraftChange: vi.fn(), onDescriptionTranscribed: vi.fn(), getCurrentDescriptionText: vi.fn(() => "Description"),
    onCancelEditDescription: vi.fn(), onSaveDescription: vi.fn(), onOpenBotManage: vi.fn(), onViewClawInfo: vi.fn(),
    onChat: vi.fn(), onShowApply: vi.fn(), onApplyRemarkChange: vi.fn(), onSubmitApply: vi.fn(), ...overrides,
  }
}
