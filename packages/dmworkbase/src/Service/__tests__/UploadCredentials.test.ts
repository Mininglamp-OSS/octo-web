import { describe, it, expect, vi, beforeEach } from "vitest"
import axios from "axios"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import APIClient from "../APIClient"
import { precheckUploadCredentials, uploadChatMedia, noInterceptorAxios } from "../UploadCredentials"
import { i18n } from "../../i18n"

// Block the barrel re-export paths that transitively pull in lottie-web / Semi-UI
// canvas initialisers, which crash under jsdom ("Cannot set properties of null").
// These stubs are enough for the tests in this file.
vi.mock("../../i18n", () => ({
    i18n: {
        setLocale: vi.fn(),
        t: (key: string) => key,
        locale: "zh-CN",
    },
    // Map the keys used by UploadCredentials.ts to their Chinese strings so that
    // the message-text assertions continue to match after the i18n mock.
    t: (key: string): string => {
        const map: Record<string, string> = {
            "base.uploadCredentials.missingFields": "响应缺少凭证字段",
            "base.uploadCredentials.failed": "上传凭证获取失败",
            "base.conversation.upload.failed": "上传失败",
        }
        return map[key] ?? key
    },
}))
vi.mock("@douyinfe/semi-ui", () => ({}))
vi.mock("lottie-web", () => ({}))

/**
 * GH Mininglamp-OSS/octo-web#119 / #135 — preflight credentials helper.
 *
 * 三条核心契约 UI 层依赖:
 *   1. 后端拒收 (e.g. 400 不支持的文件类型) 时, throw 出来的 Error 上挂 .msg
 *      直接是后端的 msg 字符串, UI 可读取后 Toast。
 *   2. HTTP 200 但响应字段缺失时, throw 一个稳定的兜底 msg。
 *   3. 成功时静默 resolve, 不返回任何东西。
 */
describe("precheckUploadCredentials", () => {
    const client = APIClient.shared
    const fakeFile = (name: string, type: string, size = 100): File =>
        new File([new Uint8Array(size)], name, { type })
    const fakeChannel = new Channel("u-test", ChannelTypePerson)

    let lastUrl: string = ""

    beforeEach(() => {
        i18n.setLocale("zh-CN", { notify: false, persist: false })
        lastUrl = ""
        client.config.tokenCallback = undefined
        client.config.spaceIdCallback = undefined
    })

    it("成功路径: 后端返回完整凭证, 静默 resolve", async () => {
        axios.defaults.adapter = async (config) => {
            lastUrl = config.url || ""
            return {
                data: {
                    uploadUrl: "https://cos.example/u",
                    downloadUrl: "https://cos.example/d",
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config,
                request: {},
            } as any
        }
        await expect(
            precheckUploadCredentials(fakeFile("a.png", "image/png"), fakeChannel, "png"),
        ).resolves.toBeUndefined()
        expect(lastUrl).toContain("file/upload/credentials")
        expect(lastUrl).toContain("filename=a.png")
        expect(lastUrl).toContain("contentType=image%2Fpng")
        expect(lastUrl).toContain(encodeURIComponent(`/${ChannelTypePerson}/u-test/`))
    })

    it("后端 400 + msg: 抛 Error.msg 透传后端 msg", async () => {
        // 模拟 axios 收到 400 时抛错的形状, 让 APIClient 拦截器走 reject 分支
        // 并把 response.data.msg 作为 reject 的 msg 字段。
        axios.defaults.adapter = async () => {
            const err: any = new Error("Request failed with status code 400")
            err.response = {
                status: 400,
                data: { msg: "不支持的文件类型", status: 400 },
                headers: {},
            }
            throw err
        }
        try {
            await precheckUploadCredentials(
                fakeFile("a.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"),
                fakeChannel,
                "xlsm",
            )
            expect.fail("应当抛出错误")
        } catch (err) {
            expect((err as { msg?: string }).msg).toBe("不支持的文件类型")
        }
    })

    it("HTTP 200 但缺 uploadUrl: 抛 '响应缺少凭证字段'", async () => {
        axios.defaults.adapter = async (config) => {
            return {
                data: { downloadUrl: "https://cos.example/d" }, // 缺 uploadUrl
                status: 200,
                statusText: "OK",
                headers: {},
                config,
                request: {},
            } as any
        }
        try {
            await precheckUploadCredentials(fakeFile("a.txt", "text/plain"), fakeChannel, "txt")
            expect.fail("应当抛出错误")
        } catch (err) {
            expect((err as { msg?: string }).msg).toBe("响应缺少凭证字段")
        }
    })

    it("网络异常: 走 fallback msg, 不至于裸 'undefined'", async () => {
        axios.defaults.adapter = async () => {
            throw new Error("Network down")
        }
        try {
            await precheckUploadCredentials(fakeFile("a.txt", "text/plain"), fakeChannel, "txt")
            expect.fail("应当抛出错误")
        } catch (err) {
            const msg = (err as { msg?: string }).msg
            expect(typeof msg).toBe("string")
            expect(msg!.length).toBeGreaterThan(0)
        }
    })
})

// ---------------------------------------------------------------------------
// uploadChatMedia — token isolation
// ---------------------------------------------------------------------------
describe("uploadChatMedia — token isolation (COS pre-signed URL)", () => {
    const fakeChannel = new Channel("u-test", ChannelTypePerson)
    const fakeFile = (name = "photo.jpg", type = "image/jpeg", size = 1024): File =>
        new File([new Uint8Array(size)], name, { type })

    const makeCreds = (uploadUrl: string) => ({
        uploadUrl,
        downloadUrl: "https://cdn.example.com/file.jpg",
        contentType: "image/jpeg",
    })

    // noInterceptorAxios is the module-level interceptor-free axios instance.
    // It is now exported (@internal) so we can spy on it directly without
    // module re-isolation.  This replaces the vi.isolateModules approach that
    // was removed in Vitest 4.

    beforeEach(() => {
        APIClient.shared.config.apiURL = "https://api.example.com/"
    })

    it("uses noInterceptorAxios (no token) for foreign-origin COS upload URL", async () => {
        const cosUrl = "https://bucket.cos.ap-shanghai.myqcloud.com/1/u-test/abc.jpg"
        const getStub = vi.spyOn(APIClient.shared, "get").mockResolvedValue(makeCreds(cosUrl))
        // Spy on the exported no-interceptor instance — the production code will call
        // noInterceptorAxios.put for foreign-origin URLs.
        const noInterceptorPutSpy = vi
            .spyOn(noInterceptorAxios, "put")
            .mockResolvedValue({ status: 200, data: {} })
        const globalPutSpy = vi.spyOn(axios, "put").mockResolvedValue({ status: 200, data: {} })

        const result = await uploadChatMedia(fakeFile(), fakeChannel, "jpg")

        // The isolated (no-interceptor) instance must handle the PUT — not global axios
        expect(noInterceptorPutSpy).toHaveBeenCalledOnce()
        expect(globalPutSpy).not.toHaveBeenCalled()
        expect(result).toBe("https://cdn.example.com/file.jpg")

        getStub.mockRestore()
        noInterceptorPutSpy.mockRestore()
        globalPutSpy.mockRestore()
    })

    it("uses global axios (with token) for same-origin upload URL", async () => {
        const sameOriginUrl = "https://api.example.com/upload/1/u-test/abc.jpg"
        const getStub = vi.spyOn(APIClient.shared, "get").mockResolvedValue(makeCreds(sameOriginUrl))
        const noInterceptorPutSpy = vi
            .spyOn(noInterceptorAxios, "put")
            .mockResolvedValue({ status: 200, data: {} })
        const globalPutSpy = vi.spyOn(axios, "put").mockResolvedValue({ status: 200, data: {} })

        await uploadChatMedia(fakeFile(), fakeChannel, "jpg")

        // Same-origin: global axios carries the session token — correct
        expect(globalPutSpy).toHaveBeenCalledOnce()
        expect(noInterceptorPutSpy).not.toHaveBeenCalled()

        getStub.mockRestore()
        noInterceptorPutSpy.mockRestore()
        globalPutSpy.mockRestore()
    })
})
