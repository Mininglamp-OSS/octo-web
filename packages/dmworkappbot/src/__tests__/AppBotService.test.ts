import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@octo/base/src/Service/APIClient", () => ({
  default: {
    shared: {
      get: vi.fn(),
      post: vi.fn(),
    },
  },
}))

import APIClient from "@octo/base/src/Service/APIClient"
import AppBotService from "../Service/AppBotService"

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
})

describe("AppBotService", () => {
  it("loads available bots without space params when no space is selected", async () => {
    apiGet.mockResolvedValueOnce([{ id: "1", uid: "robot_1", display_name: "Bot", scope: "platform" }])

    const bots = await AppBotService.getAvailableBots("")

    expect(apiGet).toHaveBeenCalledWith("/app_bot/available", undefined)
    expect(bots).toHaveLength(1)
  })

  it("loads available bots with current space id", async () => {
    apiGet.mockResolvedValueOnce([])

    await AppBotService.getAvailableBots("space-a")

    expect(apiGet).toHaveBeenCalledWith("/app_bot/available", {
      param: { space_id: "space-a" },
    })
  })

  it("keeps the legacy list filter for invalid bot rows", async () => {
    apiGet.mockResolvedValueOnce([
      { id: "1", uid: "robot_1", display_name: "Bot", scope: "platform" },
      { id: "missing-uid", display_name: "Bad", scope: "space" },
      null,
    ])

    const bots = await AppBotService.getAvailableBots("space-a")

    expect(bots).toEqual([
      { id: "1", uid: "robot_1", display_name: "Bot", scope: "platform" },
    ])
  })

  it("applies a bot through the existing endpoint and payload", async () => {
    apiPost.mockResolvedValueOnce(undefined)

    await AppBotService.applyBot("robot_1")

    expect(apiPost).toHaveBeenCalledWith("/app_bot/apply", { robot_uid: "robot_1" })
  })
})
