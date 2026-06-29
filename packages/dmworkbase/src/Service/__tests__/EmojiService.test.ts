// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

// EmojiService 通过 `import WKApp from "../App"` 读 apiClient；mock 掉以控制 manifest 拉取。
vi.mock("../../App", () => ({
  default: {
    apiClient: {
      config: { apiURL: "/api/v1/" },
      get: vi.fn(),
    },
  },
}))

import WKApp from "../../App"
import { DefaultEmojiService, Emoji, EmojiService } from "../EmojiService"

// 私有构造函数 + 单例：测试里用 `new (DefaultEmojiService as any)()` 拿到隔离实例，
// 避免共享单例造成的用例间状态串扰。
function freshService(): EmojiService {
  return new (DefaultEmojiService as any)()
}

const apiGet = WKApp.apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  apiGet.mockReset()
})

describe("EmojiService 内置兜底（未拉取 manifest）", () => {
  it("getImage 对内置自定义表情返回本地 PNG，对 Unicode 返回本地 PNG", () => {
    const svc = freshService()
    expect(svc.getImage("[使命必达]")).toBe("./emoji/custom_mission.png")
    expect(svc.getImage("[尚方宝剑]")).toBe("./emoji/custom_shangfang.png")
    expect(svc.getImage("😀")).toBe("./emoji/0_0.png")
    expect(svc.getImage("不存在")).toBe("")
  })

  it("isCustomEmoji 区分自定义与 Unicode", () => {
    const svc = freshService()
    expect(svc.isCustomEmoji?.("[使命必达]")).toBe(true)
    expect(svc.isCustomEmoji?.("😀")).toBe(false)
    expect(svc.isCustomEmoji?.("hello")).toBe(false)
  })

  it("getAllEmoji 自定义在前、含全部内置自定义 + Unicode", () => {
    const svc = freshService()
    const all = svc.getAllEmoji()
    expect(all.length).toBe(4 + 152) // 4 内置自定义 + 152 Unicode
    const firstFour = all.slice(0, 4).map((e: Emoji) => e.key)
    expect(firstFour).toEqual(["[使命必达]", "[崇尚行动]", "[有品位]", "[尚方宝剑]"])
    // name 为人类可读标签，image 为本地图
    expect(all[0].name).toBe("使命必达")
    expect(all[0].image).toBe("./emoji/custom_mission.png")
  })

  it("emojiRegExp 匹配自定义 token 与 Unicode，且缓存同一实例", () => {
    const svc = freshService()
    const re1 = svc.emojiRegExp()
    const re2 = svc.emojiRegExp()
    expect(re1).toBe(re2) // 引用相等：缓存
    expect("说好的[使命必达]呢".match(re1)?.[0]).toBe("[使命必达]")
    expect("hi😀".match(svc.emojiRegExp())?.[0]).toBe("😀")
    expect(re1.test("没有表情")).toBe(false)
  })
})

describe("EmojiService load() 拉取服务端 manifest", () => {
  it("成功：新表情用下发 url、内置空 url 回退本地、重建正则、写缓存", async () => {
    const manifest = {
      version: 7,
      list: [
        { key: "[使命必达]", name: "使命必达", url: "" }, // 内置：空 url → 本地
        { key: "[新表情]", name: "新表情", url: "emoji/custom_new.png" }, // 新增：相对 url
        { key: "[绝对图]", name: "绝对图", url: "https://cdn.example.com/a.png" },
      ],
    }
    apiGet.mockResolvedValueOnce(manifest)

    const svc = freshService()
    await svc.load?.()

    // 调用路径为相对 base 路径（apiClient 会拼 apiURL）
    expect(apiGet).toHaveBeenCalledWith("common/emojis")

    expect(svc.getImage("[使命必达]")).toBe("./emoji/custom_mission.png") // 空 url → 本地兜底
    expect(svc.getImage("[新表情]")).toBe("/api/v1/emoji/custom_new.png") // 相对 url 拼 base
    expect(svc.getImage("[绝对图]")).toBe("https://cdn.example.com/a.png") // 绝对 url 原样
    expect(svc.isCustomEmoji?.("[新表情]")).toBe(true)
    expect("发个[新表情]".match(svc.emojiRegExp())?.[0]).toBe("[新表情]")

    // 缓存已落地 localStorage
    const cached = JSON.parse(localStorage.getItem("emoji_manifest_v1") || "{}")
    expect(cached.version).toBe(7)
    expect(cached.list).toHaveLength(3)
  })

  it("失败：保持内置兜底，不抛错", async () => {
    apiGet.mockRejectedValueOnce(new Error("network down"))
    const svc = freshService()
    await expect(svc.load?.()).resolves.toBeUndefined()
    expect(svc.getImage("[使命必达]")).toBe("./emoji/custom_mission.png")
    expect(svc.getAllEmoji().length).toBe(4 + 152)
  })

  it("构造时优先读 localStorage 缓存作首屏", () => {
    localStorage.setItem(
      "emoji_manifest_v1",
      JSON.stringify({ version: 3, list: [{ key: "[缓存表情]", name: "缓存表情", url: "https://cdn/x.png" }] }),
    )
    const svc = freshService()
    expect(svc.getImage("[缓存表情]")).toBe("https://cdn/x.png")
    expect(svc.isCustomEmoji?.("[缓存表情]")).toBe(true)
    // 缓存里没有内置项 → 内置不再出现在自定义集（符合"清单即真源"）
    expect(svc.isCustomEmoji?.("[使命必达]")).toBe(false)
  })
})
