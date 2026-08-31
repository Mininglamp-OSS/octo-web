// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import BotDetailModal from "../index"

describe("BotDetailModal interaction helpers", () => {
  it("covers close/chat, keyboard, avatar, and description guards", async () => {
    const onClose = vi.fn(), onChat = vi.fn()
    const modal: any = new BotDetailModal({ uid: "bot", visible: true, onClose, onChat })
    modal.setState = vi.fn()
    modal.forceUpdate = vi.fn()
    modal.vm = {
      state: { uploadingAvatar: false, avatarPreviewFile: null, avatarCropFile: null },
      isOwner: () => false, resetTransientState: vi.fn(), mount: vi.fn(), unmount: vi.fn(),
      addListener: vi.fn(() => vi.fn()), loadBotInfo: vi.fn(), setUid: vi.fn(),
      updateChannelInfo: vi.fn(), updateDescriptionDraftWithTranscription: vi.fn(),
      startEditDescription: vi.fn(), cancelEditDescription: vi.fn(), startEditRemark: vi.fn(), cancelEditRemark: vi.fn(),
      setAvatarPreviewFile: vi.fn(), setAvatarCropFile: vi.fn(), uploadAvatar: vi.fn().mockResolvedValue("ok"),
      updateRemark: vi.fn(), updateDescription: vi.fn(),
    }
    modal.handleChat(); modal.handleClose(); modal.stripDisplayName("Bot (bot)")
    modal.handleDescriptionVoiceTranscribed("text", "append" as any)
    modal.handleAvatarClick()
    modal.handleAvatarKeyDown({ key: "Enter", preventDefault: vi.fn() } as any)
    modal.handleEditDescriptionKeyDown({ key: "Enter", preventDefault: vi.fn() } as any)
    modal.handleEditRemarkKeyDown({ key: " " , preventDefault: vi.fn() } as any)
    modal.handleAvatarInputClick({ target: { value: "old" } } as any)
    await modal.handleAvatarFileChange({ target: { files: [] } } as any)
    await modal.handleAvatarPreviewSave()
    modal.handleAvatarCropCancel(); modal.handleAvatarPreviewCancel()
    modal.componentDidUpdate({ uid: "old", visible: true } as any)
    modal.componentWillUnmount()
    expect(onChat).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it("covers owner edits, apply flow, avatar files, and lifecycle listeners", async () => {
    const modal: any = new BotDetailModal({ uid: "bot", visible: true, onClose: vi.fn(), onChat: vi.fn() })
    modal.forceUpdate = vi.fn()
    let uploadResult: any = "ok"
    const state: any = {
      uploadingAvatar: false, avatarPreviewFile: new File(["gif"], "a.gif", { type: "image/gif" }),
      avatarCropFile: null, name: "Bot (bot)", showApplyInput: false,
    }
    const listener = vi.fn()
    modal.vm = {
      state, isOwner: () => true, resetTransientState: vi.fn(), mount: vi.fn(), unmount: vi.fn(),
      addListener: vi.fn(() => listener), loadBotInfo: vi.fn(), setUid: vi.fn(), updateChannelInfo: vi.fn(),
      updateDescriptionDraftWithTranscription: vi.fn(), startEditDescription: vi.fn(), cancelEditDescription: vi.fn(),
      startEditRemark: vi.fn(), cancelEditRemark: vi.fn(), setAvatarPreviewFile: vi.fn(), setAvatarCropFile: vi.fn(),
      uploadAvatar: vi.fn(async () => uploadResult), saveDescription: vi.fn(async () => "ok"),
      saveRemark: vi.fn(async () => "failed"), showApplyInput: vi.fn(), submitApply: vi.fn(async () => "ok"),
      openClawInfo: vi.fn(), openBotManage: vi.fn(), closeClawInfo: vi.fn(), setUid: vi.fn(),
    }

    modal.componentDidMount()
    expect(modal.vm.mount).toHaveBeenCalled()
    modal.handleDescriptionVoiceTranscribed("x", "replace" as any, { start: 0, end: 0 } as any)
    modal.handleStartEditDescription(); modal.handleCancelEditDescription()
    await modal.handleSaveDescription()
    modal.handleStartEditRemark(); modal.handleCancelEditRemark(); await modal.handleSaveRemark()
    modal.handleShowApply(); await modal.handleSubmitApply()
    modal.handleViewClawInfo(); modal.handleOpenBotManage({ stopPropagation: vi.fn() } as any)
    expect(modal.vm.showApplyInput).toHaveBeenCalled()

    const input = { click: vi.fn() }
    modal.$fileInput = input
    modal.handleAvatarClick()
    expect(input.click).toHaveBeenCalled()
    const gif = new File(["gif"], "a.gif", { type: "image/gif" })
    const png = new File(["png"], "a.png", { type: "image/png" })
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" })
    await modal.handleAvatarFileChange({ target: { files: [huge] } } as any)
    await modal.handleAvatarFileChange({ target: { files: [gif] } } as any)
    await modal.handleAvatarFileChange({ target: { files: [png] } } as any)
    expect(modal.vm.setAvatarPreviewFile).toHaveBeenCalledWith(gif)
    expect(modal.vm.setAvatarCropFile).toHaveBeenCalledWith(png)

    await modal.handleAvatarPreviewSave()
    uploadResult = "failed"
    await modal.uploadBotAvatar(png)
    uploadResult = "other"
    await modal.uploadBotAvatar(png)
    modal.vm.state.uploadingAvatar = true
    modal.handleAvatarCropCancel(); modal.handleAvatarPreviewCancel()
    modal.vm.state.uploadingAvatar = false
    modal.handleAvatarCropCancel(); modal.handleAvatarPreviewCancel()
    modal.avatarEdit = { getImageScaledToCanvas: () => null }
    await modal.handleAvatarCropSave()
    modal.componentDidUpdate({ uid: "old", visible: true } as any)
    modal.componentWillUnmount()
    expect(modal.vm.setUid).toHaveBeenCalledWith("bot")
    expect(modal.vm.unmount).toHaveBeenCalled()
  })
})
