import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the App module so fetchLlmModels uses a controllable apiClient.post, and
// stub botsApi (it has heavy transitive UI deps) down to just fleetApiBase.
const { post } = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock("../../App", () => ({ default: { apiClient: { post } } }))
vi.mock("./botsApi", () => ({ fleetApiBase: () => "/fleet/api/v1/" }))

import { fetchLlmModels } from "./ccInstallApi"

describe("fetchLlmModels", () => {
    beforeEach(() => post.mockReset())

    it("returns model ids from the proxy response", async () => {
        post.mockResolvedValue({ data: { models: ["m1", "m2"] } })
        await expect(fetchLlmModels("https://gw", "sk")).resolves.toEqual(["m1", "m2"])
        expect(post).toHaveBeenCalledWith(
            "/runtimes/llm-models",
            { gateway_url: "https://gw", api_key: "sk" },
            expect.objectContaining({ baseURL: expect.any(String) }),
        )
    })

    it("returns [] when models is missing or not an array", async () => {
        post.mockResolvedValue({ data: {} })
        await expect(fetchLlmModels("https://gw", "sk")).resolves.toEqual([])
        post.mockResolvedValue({ data: { models: "nope" } })
        await expect(fetchLlmModels("https://gw", "sk")).resolves.toEqual([])
    })
})
