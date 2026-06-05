import { beforeEach, describe, expect, it, vi } from "vitest"
import axios from "axios"
import APIClient from "../APIClient"

describe("APIClient stale local resource interceptor", () => {
    const client = APIClient.shared
    let logoutFn: ReturnType<typeof vi.fn>
    let staleFn: ReturnType<typeof vi.fn>

    beforeEach(() => {
        logoutFn = vi.fn()
        staleFn = vi.fn()
        client.logoutCallback = logoutFn
        client.staleLocalResourceCallback = staleFn
        client.config.tokenCallback = undefined
        client.config.spaceIdCallback = undefined
    })

    it("device_not_found code triggers staleLocalResourceCallback once, NOT logoutCallback", async () => {
        axios.defaults.adapter = async () => {
            const err: any = new Error("400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.server.user.device_not_found",
                        http_status: 404,
                        message: "未查询到该设备。",
                    },
                    msg: "未查询到该设备。",
                    status: 400,
                },
                headers: {},
            }
            throw err
        }
        await expect(client.get("/v1/user/devices/x")).rejects.toMatchObject({
            code: "err.server.user.device_not_found",
        })
        expect(staleFn).toHaveBeenCalledTimes(1)
        expect(staleFn).toHaveBeenCalledWith("err.server.user.device_not_found")
        expect(logoutFn).not.toHaveBeenCalled()
    })

    it("auth-expired (token_expired) still triggers logoutCallback only", async () => {
        axios.defaults.adapter = async () => {
            const err: any = new Error("400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.shared.auth.token_expired",
                        http_status: 401,
                        message: "expired",
                    },
                },
                headers: {},
            }
            throw err
        }
        await expect(client.get("/anything")).rejects.toMatchObject({
            code: "err.shared.auth.token_expired",
        })
        expect(logoutFn).toHaveBeenCalledTimes(1)
        expect(staleFn).not.toHaveBeenCalled()
    })

    it("login_device_expired (cousin code, HTTP 401) routes via auth-expired path, not stale path", async () => {
        // Server emits this for the device-lock SMS-verify flow when the Redis
        // login-device cache expired. It's a 401 — auth-expired classifier
        // catches it via httpStatus fallback. Verifies the two device-related
        // server codes don't accidentally both go through stale path.
        axios.defaults.adapter = async () => {
            const err: any = new Error("401")
            err.response = {
                status: 401,
                data: {
                    error: {
                        code: "err.server.user.login_device_expired",
                        http_status: 401,
                        message: "登录设备已过期",
                    },
                },
                headers: {},
            }
            throw err
        }
        await expect(client.get("/anything")).rejects.toMatchObject({})
        expect(logoutFn).toHaveBeenCalledTimes(1)
        expect(staleFn).not.toHaveBeenCalled()
    })

    it("concurrent stale device responses each invoke callback (re-entry expected; mitigation lives in WKApp.logout)", async () => {
        let n = 0
        axios.defaults.adapter = async () => {
            n++
            const err: any = new Error("400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.server.user.device_not_found",
                        http_status: 404,
                        message: "x",
                    },
                },
                headers: {},
            }
            throw err
        }
        const p1 = client.get("/a").catch(() => {})
        const p2 = client.get("/b").catch(() => {})
        await Promise.all([p1, p2])
        expect(n).toBe(2)
        expect(staleFn).toHaveBeenCalledTimes(2)
    })

    it("unrelated 404 codes do NOT trigger staleLocalResourceCallback", async () => {
        axios.defaults.adapter = async () => {
            const err: any = new Error("404")
            err.response = {
                status: 404,
                data: {
                    error: {
                        code: "err.server.user.not_found",
                        http_status: 404,
                        message: "no such user",
                    },
                },
                headers: {},
            }
            throw err
        }
        await expect(client.get("/v1/users/missing")).rejects.toMatchObject({})
        expect(staleFn).not.toHaveBeenCalled()
        expect(logoutFn).not.toHaveBeenCalled()
    })

    it("interceptor still fires callback even if normalized.code is captured from envelope", async () => {
        // Defensive: confirm the callback receives the actual code string,
        // not undefined / a fallback. This guards against future refactors
        // of normalizeApiError that might drop the code field.
        axios.defaults.adapter = async () => {
            const err: any = new Error("400")
            err.response = {
                status: 400,
                data: {
                    error: {
                        code: "err.server.user.device_not_found",
                        http_status: 404,
                        message: "msg",
                    },
                },
                headers: {},
            }
            throw err
        }
        await client.get("/v1/user/devices/probe").catch(() => {})
        expect(staleFn).toHaveBeenCalledTimes(1)
        expect(staleFn).toHaveBeenCalledWith("err.server.user.device_not_found")
    })
})
