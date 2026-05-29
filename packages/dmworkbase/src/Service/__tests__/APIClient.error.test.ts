import { beforeEach, describe, expect, it, vi } from "vitest"
import axios from "axios"
import APIClient from "../APIClient"
import { i18n } from "../../i18n/instance"

describe("APIClient backend i18n contract", () => {
    const client = APIClient.shared
    let captured: any = null

    beforeEach(() => {
        captured = null
        i18n.setLocale("zh-CN", { notify: false, persist: false })
        client.config.tokenCallback = undefined
        client.config.spaceIdCallback = undefined
        client.logoutCallback = undefined
    })

    it("adds Accept-Language without trusted backend-only i18n headers", async () => {
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

        await client.get("/ping")
        expect(captured.headers["Accept-Language"]).toBe("zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
        expect(captured.headers["X-Octo-Lang"]).toBeUndefined()
        expect(captured.headers["X-Octo-Error-Envelope"]).toBeUndefined()

        i18n.setLocale("en-US", { notify: false, persist: false })
        await client.get("/ping")
        expect(captured.headers["Accept-Language"]).toBe("en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")
    })

    it("uses v2 error.http_status for auth logout when outer status is compatibility 400", async () => {
        const logout = vi.fn()
        client.logoutCallback = logout
        axios.defaults.adapter = async () => {
            const err: any = new Error("Request failed with status code 400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.shared.auth.token_expired",
                        message: "backend says login",
                        http_status: 401,
                    },
                    msg: "legacy message",
                    status: 400,
                },
                headers: {},
            }
            throw err
        }

        await expect(client.get("/private")).rejects.toMatchObject({
            msg: "登录已过期，请重新登录",
            status: 401,
            code: "err.shared.auth.token_expired",
        })
        expect(logout).toHaveBeenCalledTimes(1)
    })

    it("does not logout for forbidden v2 errors", async () => {
        const logout = vi.fn()
        client.logoutCallback = logout
        axios.defaults.adapter = async () => {
            const err: any = new Error("Request failed with status code 400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.shared.auth.forbidden",
                        message: "没有权限",
                        http_status: 403,
                    },
                },
                headers: {},
            }
            throw err
        }

        await expect(client.get("/forbidden")).rejects.toMatchObject({
            msg: "没有权限",
            status: 403,
            code: "err.shared.auth.forbidden",
        })
        expect(logout).not.toHaveBeenCalled()
    })

    it("hides backend message for internal errors", async () => {
        axios.defaults.adapter = async () => {
            const err: any = new Error("Request failed with status code 400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.shared.internal",
                        message: "sql secret stack trace",
                        http_status: 500,
                    },
                },
                headers: {},
            }
            throw err
        }

        await expect(client.get("/boom")).rejects.toMatchObject({
            msg: "未知错误",
            status: 500,
            code: "err.shared.internal",
        })
    })

    it("keeps legacy msg compatibility", async () => {
        axios.defaults.adapter = async () => {
            const err: any = new Error("Request failed with status code 400")
            err.response = {
                status: 400,
                data: { msg: "不支持的文件类型", status: 400 },
                headers: {},
            }
            throw err
        }

        await expect(client.get("/legacy")).rejects.toMatchObject({
            msg: "不支持的文件类型",
            status: 400,
        })
    })
})
