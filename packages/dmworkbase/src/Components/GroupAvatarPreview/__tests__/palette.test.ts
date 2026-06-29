import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * GroupAvatarPreview 色板测试。
 *
 * 覆盖：
 *  - colorAt 越界回退、paletteSize 取数；
 *  - fetchGroupAvatarPalette 的三态契约：成功映射 icon_back→iconBack 并缓存去重、
 *    空响应回退兜底且**不缓存**（下次重试）、异常回退兜底。
 *
 * 模块级 cache/inflight 是单例，故每个用例用 resetModules + 动态 import 拿到全新实例，
 * 避免状态串台。WKApp 被 mock 掉，既隔离网络也避免加载重型 App 模块。
 */

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock("../../../App", () => ({ default: { apiClient: { get: getMock } } }))

beforeEach(() => {
  vi.resetModules()
  getMock.mockReset()
})

async function loadPalette() {
  return import("../palette")
}

describe("colorAt — 取档与越界回退", () => {
  const P = [
    { index: 0, main: "m0", fill: "f0", iconBack: "b0" },
    { index: 1, main: "m1", fill: "f1", iconBack: "b1" },
  ]

  it("正常取对应档", async () => {
    const { colorAt } = await loadPalette()
    expect(colorAt(P, 1)).toEqual(P[1])
  })

  it("越界 / 负数回退首档", async () => {
    const { colorAt } = await loadPalette()
    expect(colorAt(P, 5)).toEqual(P[0])
    expect(colorAt(P, -1)).toEqual(P[0])
  })

  it("空色板回退内置兜底首档", async () => {
    const { colorAt } = await loadPalette()
    // 兜底首档 main 同步自服务端 palette.go index 0
    expect(colorAt([], 0).main).toBe("#14C0FF")
  })
})

describe("paletteSize — 档数", () => {
  it("给定色板返回其长度", async () => {
    const { paletteSize } = await loadPalette()
    expect(paletteSize([{ index: 0, main: "a", fill: "b", iconBack: "c" }])).toBe(1)
  })

  it("未就绪时返回兜底色板档数（10）", async () => {
    const { paletteSize } = await loadPalette()
    expect(paletteSize()).toBe(10)
  })
})

describe("fetchGroupAvatarPalette — 三态契约", () => {
  it("成功：映射 icon_back→iconBack，并缓存去重", async () => {
    getMock.mockResolvedValue({
      size: 2,
      colors: [
        { index: 0, main: "m", fill: "f", icon_back: "ic0" },
        { index: 1, main: "m1", fill: "f1", icon_back: "ic1" },
      ],
    })
    const { fetchGroupAvatarPalette } = await loadPalette()
    const r = await fetchGroupAvatarPalette()
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ index: 0, main: "m", fill: "f", iconBack: "ic0" })

    // 第二次命中缓存，不再发请求
    await fetchGroupAvatarPalette()
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it("空响应：回退兜底且不缓存，下次重试", async () => {
    getMock.mockResolvedValue({ size: 0, colors: [] })
    const { fetchGroupAvatarPalette } = await loadPalette()
    const r = await fetchGroupAvatarPalette()
    expect(r).toHaveLength(10) // 兜底

    // 未缓存 → 改为有效响应后再次调用应重新请求并返回新值
    getMock.mockResolvedValue({
      size: 1,
      colors: [{ index: 0, main: "x", fill: "y", icon_back: "z" }],
    })
    const r2 = await fetchGroupAvatarPalette()
    expect(r2).toHaveLength(1)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it("异常：回退兜底", async () => {
    getMock.mockRejectedValue(new Error("network down"))
    const { fetchGroupAvatarPalette } = await loadPalette()
    const r = await fetchGroupAvatarPalette()
    expect(r).toHaveLength(10)
  })
})
