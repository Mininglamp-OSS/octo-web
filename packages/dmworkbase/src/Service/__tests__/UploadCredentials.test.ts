import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import axios from "axios"
import { Channel, ChannelTypePerson } from "wukongimjssdk"
import APIClient from "../APIClient"
import { precheckUploadCredentials, uploadChatMedia } from "../UploadCredentials"
import { i18n } from "../../i18n"

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

    afterEach(() => {
        vi.restoreAllMocks()
        axios.defaults.adapter = undefined
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

    it("uploadChatMedia: 先取凭证再直传，并返回 downloadUrl", async () => {
        const get = vi.spyOn(client, "get").mockResolvedValue({
            uploadUrl: "https://cos.example/upload",
            downloadUrl: "https://cos.example/download",
            contentType: "image/png",
            contentDisposition: "inline",
        } as any)
        const put = vi.spyOn(axios, "put").mockResolvedValue({ status: 204 } as any)

        await expect(uploadChatMedia(fakeFile("a.png", "image/png"), fakeChannel, "png"))
            .resolves.toBe("https://cos.example/download")
        expect(get).toHaveBeenCalledWith(expect.stringContaining("file/upload/credentials"))
        expect(put).toHaveBeenCalledWith(
            "https://cos.example/upload",
            expect.any(File),
            expect.objectContaining({
                headers: { "Content-Type": "image/png", "Content-Disposition": "inline" },
                timeout: 120000,
            }),
        )
    })

    it("uploadChatMedia: 缺少凭证字段时不发起直传", async () => {
        vi.spyOn(client, "get").mockResolvedValue({ uploadUrl: "https://cos.example/upload" } as any)
        const put = vi.spyOn(axios, "put")

        await expect(uploadChatMedia(fakeFile("a.txt", "text/plain"), fakeChannel, "txt"))
            .rejects.toMatchObject({ msg: "响应缺少凭证字段" })
        expect(put).not.toHaveBeenCalled()
    })

    it("uploadChatMedia: 非 2xx 直传响应转换为上传失败", async () => {
        vi.spyOn(client, "get").mockResolvedValue({
            uploadUrl: "https://cos.example/upload",
            downloadUrl: "https://cos.example/download",
            contentType: "text/plain",
        } as any)
        vi.spyOn(axios, "put").mockResolvedValue({ status: 500 } as any)

        await expect(uploadChatMedia(fakeFile("a.txt", "text/plain"), fakeChannel, "txt"))
            .rejects.toMatchObject({ msg: "上传失败" })
    })

    it("uploadChatMedia: axios 直传拒绝时透传网络错误", async () => {
        vi.spyOn(client, "get").mockResolvedValue({
            uploadUrl: "https://cos.example/upload",
            downloadUrl: "https://cos.example/download",
            contentType: "text/plain",
        } as any)
        vi.spyOn(axios, "put").mockRejectedValue(new Error("server rejected"))

        await expect(uploadChatMedia(fakeFile("a.txt", "text/plain"), fakeChannel, "txt"))
            .rejects.toMatchObject({ msg: "server rejected" })
    })

    it("uploadChatMedia: scales timeout for files larger than the floor", async () => {
        vi.spyOn(client, "get").mockResolvedValue({
            uploadUrl: "https://cos.example/upload",
            downloadUrl: "https://cos.example/download",
            contentType: "application/octet-stream",
        } as any)
        const put = vi.spyOn(axios, "put").mockResolvedValue({ status: 204 } as any)

        await uploadChatMedia(fakeFile("large.bin", "application/octet-stream", 13 * 1024 * 1024), fakeChannel, "bin")

        expect(put.mock.calls[0][2]).toEqual(expect.objectContaining({ timeout: 130000 }))
    })
})
