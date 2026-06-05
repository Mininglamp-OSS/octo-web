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
})
