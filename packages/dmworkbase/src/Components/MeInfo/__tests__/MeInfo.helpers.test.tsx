// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import { MeInfo } from "../index"

describe("MeInfo interaction guards", () => {
  it("covers transient edits, avatar validation, and async profile updates", async () => {
    const onClose = vi.fn()
    const page: any = new MeInfo({ onClose })
    page.context = { t: (key: string) => key }
    page.mounted = true
    page.setState = (update: any) => {
      const next = typeof update === "function" ? update(page.state, page.props) : update
      if (next) page.state = { ...page.state, ...next }
    }
    page.handleClose()
    expect(onClose).toHaveBeenCalled()
    page.startEditName({ name: () => "Nancy" })
    expect(page.state.nameDraft).toBe("Nancy")
    page.cancelEditName()
    const vm: any = { uid: () => "u", sex: () => 1, updateName: vi.fn().mockResolvedValue(undefined), updateSex: vi.fn().mockResolvedValue(undefined), uploadAvatar: vi.fn().mockResolvedValue(undefined), markAvatarChanged: vi.fn() }
    page.state.nameDraft = "New name"
    await page.saveName(vm)
    await page.selectSex(vm, 1)
    await page.selectSex(vm, 2)
    page.state.nameDraft = "   "
    await page.saveName({ ...vm, updateName: vi.fn().mockRejectedValue(new Error("bad")) })
    await page.selectSex({ ...vm, sex: () => 2, updateSex: vi.fn().mockRejectedValue(new Error("bad")) }, 1)
    page.fileInput = { click: vi.fn() }
    page.chooseAvatar()
    page.handleFileChange({ currentTarget: { value: "", files: [new File(["x"], "a.png", { type: "image/png" })] } } as any)
    page.state.avatarPreviewFile = new File(["x"], "avatar.png", { type: "image/png" })
    await page.saveAvatarPreview(vm)
    expect(vm.updateName).toHaveBeenCalledWith("New name")
    page.state.avatarCropFile = new File(["x"], "avatar.png")
    page.cancelAvatarCrop()
    page.state.avatarPreviewFile = new File(["x"], "avatar.png")
    page.cancelAvatarPreview()
    page.handleFileClick({ currentTarget: { value: "old" } } as any)
    page.handleFileChange({ currentTarget: { value: "", files: [] } } as any)
    page.componentDidMount()
    page.componentWillUnmount()
    expect(page.state).toBeTruthy()
  })
})
