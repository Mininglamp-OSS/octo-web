import { describe, expect, it, vi } from "vitest"

vi.mock("../../../App", () => ({ default: {
  dataSource: { commonDataSource: { getFileURL: (url: string) => url, getImageURL: (url: string) => url } },
  shared: { currentSpaceId: "", channelSpaceMap: new Map(), avatarUser: () => "" }, loginInfo: { uid: "me" },
} }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key, I18nContext: {} }))
vi.mock("../../../Service/Const", () => ({ MessageContentTypeConst: { smallVideo: 5 } }))
vi.mock("../../../Components/WaveCanvas", () => ({ default: () => null }))
vi.mock("../../Base", () => ({ default: ({ children }: any) => children }))
vi.mock("../../MessageCell", () => ({ MessageCell: class { constructor(props: any) { (this as any).props = props } } }))
vi.mock("../../../../bridge/message/useMessageRow", () => ({ getMessageRow: () => ({}) }))
vi.mock("../../../../ui/message/VideoContent", () => ({ default: () => null }))
vi.mock("../../../../Service/messageSelection", () => ({ isMessageSelectable: () => true }))

import { VideoCell, VideoContent } from "../index"

describe("VideoContent and VideoCell", () => {
  it("round-trips video metadata and exposes digest", () => {
    const content = new VideoContent()
    content.decodeJSON({ url: "video.mp4", cover: "cover.png", size: 10, width: 320, height: 240, second: 7 })
    expect(content.encodeJSON()).toEqual({ url: "video.mp4", cover: "cover.png", size: 10, width: 320, height: 240, second: 7 })
    expect(content.conversationDigest).toBe("base.video.digest")
  })

  it("formats duration and scales video dimensions", () => {
    const cell: any = new VideoCell({})
    expect(cell.secondFormat(0)).toBe("00:00")
    expect(cell.secondFormat(61)).toBe("01:01")
    expect(cell.secondFormat(600)).toBe("10:00")
    expect(cell.videoScale(320, 180)).toEqual({ width: 320, height: 180 })
    expect(cell.videoScale(1920, 1080)).toEqual({ width: 398.22222222222223, height: 224 })
    expect(cell.videoScale(320, 448)).toEqual({ width: 160, height: 224 })
  })

  it("builds the new video message row for selectable and uploading states", () => {
    const message: any = {
      clientMsgNo: "video-1", fromUID: "u1", checked: true,
      message: { send: false },
      content: { url: "video.mp4", cover: "cover.png", width: 320, height: 240, second: 4, file: { size: 2 * 1024 * 1024 } },
    }
    const context: any = {
      editOn: () => true, showContextMenus: vi.fn(), isContextMenuOpen: () => false,
      checkeMessage: vi.fn(), onTapAvatar: vi.fn(), showUser: vi.fn(),
    }
    const cell: any = new VideoCell({ message, context })
    cell.state.uploadProgress = 40
    cell.state.uploadStatus = 1
    expect(cell.render()).toBeTruthy()
  })
})
