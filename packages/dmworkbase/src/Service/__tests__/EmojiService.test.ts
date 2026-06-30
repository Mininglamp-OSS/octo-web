// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"

// EmojiService 现在直接依赖 Service 层的 APIClient(不再 import App，避免循环依赖)；
// mock 掉 APIClient 单例以控制 manifest 拉取与 apiURL base。
vi.mock("../APIClient", () => ({
  default: {
    shared: {
      config: { apiURL: "/api/v1/" },
      get: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import { DefaultEmojiService, Emoji, EmojiService } from "../EmojiService"

// 私有构造函数 + 单例：测试里用 `new (DefaultEmojiService as any)()` 拿到隔离实例，
// 避免共享单例造成的用例间状态串扰。
function freshService(): EmojiService {
  return new (DefaultEmojiService as any)()
}

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>

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

  it("过滤空/非法 key：空分支绝不进正则（防零宽匹配渲染死循环）", async () => {
    const manifest = {
      version: 9,
      list: [
        { key: "", name: "空", url: "x.png" }, // 空 key → 丢弃
        { key: "   ", name: "空白", url: "y.png" }, // 纯空白 → 丢弃
        { key: 123 as unknown as string, name: "非串", url: "z.png" }, // 非字符串 → 丢弃
        { key: "[正常]", name: "正常", url: "" }, // 保留
      ],
    }
    apiGet.mockResolvedValueOnce(manifest)
    const svc = freshService()
    await svc.load?.()

    expect(svc.isCustomEmoji?.("[正常]")).toBe(true)
    expect(svc.isCustomEmoji?.("")).toBe(false)
    // 关键断言：正则不含空分支，故对空串不会零宽命中（否则消费端 slice 循环会死锁）。
    expect(svc.emojiRegExp().test("")).toBe(false)
    expect("没有表情".match(svc.emojiRegExp())).toBeNull()
  })

  it("空列表：服务端显式清空自定义表情则生效", async () => {
    apiGet.mockResolvedValueOnce({ version: 10, list: [] })
    const svc = freshService()
    await svc.load?.()
    expect(svc.isCustomEmoji?.("[使命必达]")).toBe(false)
    // Unicode 仍在
    expect(svc.getImage("😀")).toBe("./emoji/0_0.png")
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

describe("EmojiService onChange 订阅", () => {
  it("清单内容变化时通知一次；相同清单不通知；取消订阅后不再通知", async () => {
    const svc = freshService()
    let calls = 0
    const unsub = svc.onChange?.(() => {
      calls++
    })

    // 引入新表情 → 与内置兜底不同 → 通知
    apiGet.mockResolvedValueOnce({ version: 1, list: [{ key: "[新]", name: "新", url: "" }] })
    await svc.load?.()
    expect(calls).toBe(1)

    // 相同清单再拉一次 → 无变化 → 不通知
    apiGet.mockResolvedValueOnce({ version: 1, list: [{ key: "[新]", name: "新", url: "" }] })
    await svc.load?.()
    expect(calls).toBe(1)

    // 取消订阅后即使变化也不再通知
    unsub?.()
    apiGet.mockResolvedValueOnce({ version: 2, list: [{ key: "[新2]", name: "新2", url: "" }] })
    await svc.load?.()
    expect(calls).toBe(1)
  })
})
