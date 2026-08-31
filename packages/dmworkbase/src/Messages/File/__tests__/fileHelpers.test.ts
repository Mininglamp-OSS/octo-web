import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskStatus } from "wukongimjssdk"

const app = vi.hoisted(() => {
  const getFileURL = vi.fn((url: string) => url)
  return {
    getFileURL,
    downloadFile: vi.fn(),
    dataSource: { commonDataSource: { getFileURL } },
    loginInfo: { uid: "me" },
  }
})

vi.mock("../../../App", () => ({
  default: app,
}))
vi.mock("../../../Service/SpacePrefix", () => ({
  isDriveTransferSupportedChannel: () => true,
  imDriveTransferSourceKey: () => "source",
  stripSpacePrefix: (value: string) => value,
}))
vi.mock("../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))
vi.mock("../../../Utils/download", () => ({ downloadFile: app.downloadFile }))
vi.mock("../../../bridge/message/useFileMessageUI", () => ({ getFileMessageUI: () => ({}) }))
vi.mock("../../../Service/Convert", () => ({ resolveExternalFileURL: (url: string) => url }))
vi.mock("../../../Components/WKModal", () => ({ default: () => null }))
vi.mock("../../../ui/message/MessageRow", () => ({ default: () => null }))
vi.mock("../../Base", () => ({ default: () => null }))
vi.mock("../../MessageCell", () => ({ MessageCell: class {} }))
vi.mock("../Text/MarkdownContent", () => ({ default: () => null }))
vi.mock("../../../i18n", () => ({ I18nContext: {}, t: (key: string) => key }))
vi.mock("@douyinfe/semi-ui", () => ({ Toast: { error: vi.fn() }, Tooltip: ({ children }: any) => children }))
vi.mock("wukongimjssdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wukongimjssdk")>()
  return {
    ...actual,
    WKSDK: { shared: () => ({}) },
  }
})

import { FileCell, formatFileSize, getExtension, getFileIconInfo, resolveSafeFileUrl } from "../index"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  app.getFileURL.mockImplementation((url: string) => url)
  app.downloadFile.mockReset()
})

describe("file message helpers", () => {
  it("formats byte sizes at each unit boundary", () => {
    expect(formatFileSize(-1)).toBe("0 B")
    expect(formatFileSize(1023)).toBe("1023 B")
    expect(formatFileSize(1024)).toBe("1.0 KB")
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB")
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.0 GB")
  })

  it("prefers a usable filename extension and falls back safely", () => {
    expect(getExtension("file", "Report.PDF")).toBe("pdf")
    expect(getExtension("env", ".env")).toBe("env")
    expect(getExtension("txt", "report.")).toBe("txt")
    expect(getExtension("", "Makefile")).toBe("")
  })

  it("maps common file families and unknown extensions", () => {
    expect(getFileIconInfo("ignored", "report.docx").label).toBe("DOC")
    expect(getFileIconInfo("ignored", "archive.tar.gz").label).toBe("ZIP")
    expect(getFileIconInfo("ignored", "photo.webp").label).toBe("IMG")
    expect(getFileIconInfo("unknown", "data.bin").label).toBe("FILE")
  })

  it("normalizes relative URLs and rejects unsafe download URLs", () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } })
    app.getFileURL.mockImplementation((url: string) => url)

    expect(resolveSafeFileUrl({ url: "/files/a.pdf" })).toBe("https://app.example/files/a.pdf")
    expect(resolveSafeFileUrl({ remoteUrl: "https://cdn.example/a.pdf" })).toBe("https://cdn.example/a.pdf")
    expect(resolveSafeFileUrl({ url: "report:final.pdf" })).toBe("https://app.example/report:final.pdf")
    app.getFileURL.mockReturnValue("/api/v1/files/a.pdf")
    expect(resolveSafeFileUrl({ url: "/files/a.pdf" })).toBe("https://app.example/api/v1/files/a.pdf")
    expect(resolveSafeFileUrl({ url: "" })).toBe("")
  })

  it("resolves file URLs and protects download/preview actions", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example" } })
    const message: any = {
      channel: { channelID: "peer", channelType: 1 },
      clientMsgNo: "client-1",
      messageID: "server-1",
      messageSeq: 4,
      status: 1,
      fromUID: "peer",
      checked: false,
      content: { url: "/files/a.txt", name: "a.txt", extension: "txt", size: 3 },
    }
    const context: any = {
      editOn: () => false,
      getActivePreviewMessageId: () => "server-1",
      isContextMenuOpen: () => false,
      showContextMenus: vi.fn(),
      checkeMessage: vi.fn(),
      onTapAvatar: vi.fn(),
      showUser: vi.fn(),
      t: (key: string) => key,
    }
    const cell: any = new FileCell({ message, context })
    cell.props = { message, context }
    cell.context = context
    expect(cell.getFileURL(message.content)).toBe("https://app.example/files/a.txt")
    await cell.handleDownload()
    expect(app.downloadFile).toHaveBeenCalledWith("https://app.example/files/a.txt", "a.txt")

    ;(app as any).getFileURL.mockReturnValue("javascript:alert(1)")
    await expect(cell.handleDownload()).resolves.toBeUndefined()
    expect(app.downloadFile).toHaveBeenCalledWith("https://app.example/javascript:alert(1)", "a.txt")
    ;(app as any).getFileURL.mockImplementation((url: string) => url)
  })

  it("previews text content with response and size guards", async () => {
    const message: any = {
      channel: { channelID: "peer", channelType: 1 },
      clientMsgNo: "client-2",
      messageID: "server-2",
      status: 1,
      content: { url: "/files/a.txt", name: "a.txt", extension: "txt", size: 3 },
    }
    const cell: any = new FileCell({ message, context: {} })
    cell.props = { message, context: {} }
    cell.context = { t: (key: string) => key }
    cell.setState = vi.fn()
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      headers: { get: () => "3" },
      arrayBuffer: async () => new TextEncoder().encode("abc").buffer,
    })))
    await cell.handleTextPreview("https://app.example/a.txt", "a.txt", "TXT")
    expect(cell.setState).toHaveBeenCalledWith(expect.objectContaining({
      textPreviewVisible: true,
      textPreviewContent: "abc",
      textPreviewExt: "txt",
    }))
  })

  it("renders upload, failure and regular file states", () => {
    const context: any = {
      editOn: () => true,
      getActivePreviewMessageId: () => "server-3",
      isContextMenuOpen: () => false,
      showContextMenus: vi.fn(),
      checkeMessage: vi.fn(),
      onTapAvatar: vi.fn(),
      showUser: vi.fn(),
      t: (key: string) => key,
    }
    const makeCell = (status: any, extension: string) => {
      const message: any = {
        channel: { channelID: "peer", channelType: 1 },
        clientMsgNo: "client-3",
        messageID: "server-3",
        status: 1,
        fromUID: "peer",
        checked: true,
        content: { url: "/files/a", name: "a", extension, size: 2 * 1024 * 1024 },
      }
      const cell: any = new FileCell({ message, context })
      cell.props = { message, context }
      cell.context = context
      cell.state.uploadProgress = 42
      cell.state.uploadStatus = status
      return cell
    }

    expect(makeCell(TaskStatus.uploading, "pdf").render()).toBeTruthy()
    expect(makeCell(TaskStatus.fail, "docx").render()).toBeTruthy()
    expect(makeCell(TaskStatus.success, "bin").render()).toBeTruthy()
  })

  it("saves files to drive and emits preview metadata", async () => {
    const emits = vi.fn()
    const save = vi.fn(async () => ({ file_id: 8, space_id: "space", parent_id: 0 }))
    ;(app as any).saveMessageToDrive = save
    ;(app as any).remoteConfig = { driveOn: true }
    ;(app as any).mittBus = { emit: emits }
    ;(app as any).openDriveFile = vi.fn()
    const message: any = {
      channel: { channelID: "peer", channelType: 1 },
      clientMsgNo: "client-4",
      messageID: "server-4",
      messageSeq: 5,
      status: 1,
      fromUID: "peer",
      content: { url: "/files/a.pdf", name: "a.pdf", extension: "pdf", size: 4 },
    }
    const cell: any = new FileCell({ message, context: {} })
    cell.props = { message, context: {} }
    cell.context = { t: (key: string) => key }
    cell.setState = vi.fn()
    await cell.handleSaveToDrive()
    expect(save).toHaveBeenCalledWith({ im_group_no: "peer", im_channel_type: 1, im_msg_id: "server-4" })
    expect(cell.setState).toHaveBeenCalledWith(expect.objectContaining({ imTransferred: expect.objectContaining({ exists: true }) }))
    cell.state.imTransferred = { exists: true, file_id: 8, space_id: "space", parent_id: 0 }
    await cell.handleSaveToDrive()
    expect((app as any).openDriveFile).toHaveBeenCalledWith({ file_id: 8, space_id: "space", parent_id: 0 })
    cell.handlePreview()
    expect(emits).toHaveBeenCalledWith("wk:file-preview", expect.objectContaining({ name: "a.pdf", extension: "pdf" }))
  })
})
