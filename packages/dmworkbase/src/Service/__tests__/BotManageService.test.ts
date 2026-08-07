import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import BotManageService from "../BotManageService"

const apiDelete = APIClient.shared.delete as unknown as ReturnType<typeof vi.fn>
const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiDelete.mockReset()
  apiGet.mockReset()
  apiPut.mockReset()
})

describe("BotManageService", () => {
  it("listGroups calls robot groups endpoint with limit", async () => {
    apiGet.mockResolvedValueOnce({ list: [] })

    await BotManageService.listGroups({ robotId: "bot1", limit: 30 })

    expect(apiGet).toHaveBeenCalledWith("robot/bot1/groups", {
      param: { limit: 30 },
    })
  })

  it("listGroups includes cursor when provided", async () => {
    apiGet.mockResolvedValueOnce({ list: [] })

    await BotManageService.listGroups({
      robotId: "bot1",
      limit: 30,
      cursor: "C2",
    })

    expect(apiGet).toHaveBeenCalledWith("robot/bot1/groups", {
      param: { limit: 30, cursor: "C2" },
    })
  })

  it("enableMentionFree calls mention preference endpoint", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotManageService.enableMentionFree("bot1", "group-a")

    expect(apiPut).toHaveBeenCalledWith(
      "robot/bot1/groups/group-a/mention_pref",
      { no_mention: 1 },
    )
  })

  it("disableMentionFree deletes mention preference", async () => {
    apiDelete.mockResolvedValueOnce(undefined)

    await BotManageService.disableMentionFree("bot1", "group-a")

    expect(apiDelete).toHaveBeenCalledWith(
      "robot/bot1/groups/group-a/mention_pref",
    )
  })
})

/**
 * 卡片设置的三个端点：路径与 payload 形状的契约测试。
 *
 * VM 测试把整个 Service 模块 mock 掉了，所以那边跑绿并不能证明这三个方法真的打在
 * 正确的 URL 上、body 形状正确 —— 这一层专门盯这件事。
 */
describe("BotManageService card settings endpoints", () => {
  it("listSettings 读目录，不带任何 query 参数", async () => {
    apiGet.mockResolvedValueOnce({ list: [] })

    await BotManageService.listSettings("bot1")

    expect(apiGet).toHaveBeenCalledWith("robot/bot1/settings")
  })

  it("putSettings 把覆盖包在 items 数组里批量提交", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotManageService.putSettings("bot1", [
      { key: "bot.display_enabled", value: false },
      { key: "bot.reasoning_enabled", value: true },
    ])

    // 服务端要的是 { items: [...] }，全批原子；不是逐项 PUT，也不是裸数组。
    expect(apiPut).toHaveBeenCalledWith("robot/bot1/settings", {
      items: [
        { key: "bot.display_enabled", value: false },
        { key: "bot.reasoning_enabled", value: true },
      ],
    })
  })

  it("putSettings 传 JSON bool 而不是字符串", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotManageService.putSettings("bot1", [
      { key: "bot.display_enabled", value: false },
    ])

    const body = apiPut.mock.calls[0][1] as {
      items: Array<{ value: unknown }>
    }
    expect(typeof body.items[0].value).toBe("boolean")
  })

  it("deleteSetting 删单个覆盖，key 走 URL 编码", async () => {
    apiDelete.mockResolvedValueOnce(undefined)

    await BotManageService.deleteSetting("bot1", "bot.display_enabled")

    // 点号不被 encodeURIComponent 转义，所以路径保持可读；编码是为了防 key 里
    // 出现路径分隔符等意外字符。
    expect(apiDelete).toHaveBeenCalledWith(
      "robot/bot1/settings/bot.display_enabled",
    )
  })

  it("deleteSetting 对含特殊字符的 key 做编码，不让它逃出路径段", async () => {
    apiDelete.mockResolvedValueOnce(undefined)

    await BotManageService.deleteSetting("bot1", "a/b?c")

    expect(apiDelete).toHaveBeenCalledWith("robot/bot1/settings/a%2Fb%3Fc")
  })
})
