import { describe, it, expect, beforeEach } from "vitest"
import axios from "axios"
import APIClient from "../APIClient"

/**
 * GH Mininglamp-OSS/octo-web#1038 — APIClient request interceptor 统一注入 X-Space-Id header。
 *
 * 这里复用 APIClient.shared 单例（其 initAxios 已在 import 时对全局 axios
 * 注册了一次 request interceptor）。测试通过 axios adapter stub 截获即将发出的
 * config，读取 interceptor 计算后的 headers 并断言。
 *
 * 覆盖 4 个场景：无 space / 有 space / 切换后 / 与 token 共存。
 */
describe("APIClient request interceptor — X-Space-Id (GH #1038)", () => {
    const client = APIClient.shared

    // 记录 interceptor 运行后即将发出的请求 config
    let captured: any = null

    beforeEach(() => {
        captured = null
        // 用自定义 adapter 短路实际网络请求，返回 200 空体
        axios.defaults.adapter = async (config) => {
            captured = config
            return {
                data: {},
                status: 200,
                statusText: "OK",
                headers: {},
                config,
                request: {},
            } as any
        }
        // 清空回调，每个用例独立配置
        client.config.tokenCallback = undefined
        client.config.spaceIdCallback = undefined
    })

    it("不注入 X-Space-Id：spaceIdCallback 未设置", async () => {
        await client.get("/ping")
        expect(captured).not.toBeNull()
        expect(captured.headers["X-Space-Id"]).toBeUndefined()
    })

    it("不注入 X-Space-Id：spaceIdCallback 返回空串", async () => {
        client.config.spaceIdCallback = () => ""
        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBeUndefined()
    })

    it("不注入 X-Space-Id：spaceIdCallback 返回 undefined", async () => {
        client.config.spaceIdCallback = () => undefined
        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBeUndefined()
    })

    it("注入 X-Space-Id：spaceIdCallback 返回非空 space_id", async () => {
        const SPACE_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
        client.config.spaceIdCallback = () => SPACE_ID
        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBe(SPACE_ID)
    })

    it("切换 space 后 header 随之更新（每次请求惰性读取回调）", async () => {
        let current = "space-alpha"
        client.config.spaceIdCallback = () => current

        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBe("space-alpha")

        current = "space-beta"
        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBe("space-beta")

        current = "" // 切回 no-space
        await client.get("/ping")
        expect(captured.headers["X-Space-Id"]).toBeUndefined()
    })

    it("与 token 共存：两个 header 同时被注入", async () => {
        client.config.tokenCallback = () => "tkn_abc123"
        client.config.spaceIdCallback = () => "space-gamma"
        await client.get("/ping")
        expect(captured.headers["token"]).toBe("tkn_abc123")
        expect(captured.headers["X-Space-Id"]).toBe("space-gamma")
    })
})

/**
 * YUJ-2628 — 登录页一直转圈的根因：APIClient 没有任何请求超时。
 * 请求永久挂起时 LoginVM.loginLoading 停在 true，按钮一直转圈无法恢复。
 * 这里验证全局默认 timeout 已配置（超时/网络错误的归类见 apiError.test.ts）。
 */
describe("APIClient request timeout (YUJ-2628)", () => {
    it("注册了全局默认超时（不再永久挂起）", () => {
        // 触发单例构造 → initAxios 设置 axios.defaults.timeout
        expect(APIClient.shared).toBeTruthy()
        expect(axios.defaults.timeout).toBeGreaterThan(0)
    })
})
