import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      delete: vi.fn(),
      get: vi.fn(),
      put: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import BotManageService from "../BotManageService"

const apiDelete = APIClient.shared.delete as unknown as ReturnType<typeof vi.fn>
const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiDelete.mockReset()
  apiGet.mockReset()
  apiPut.mockReset()
})

describe("BotManageService", () => {
  it("listGroups calls robot groups endpoint with limit", async () => {
    apiGet.mockResolvedValueOnce({ list: [] })

    await BotManageService.listGroups({ robotId: "bot1", limit: 30 })

    expect(apiGet).toHaveBeenCalledWith("robot/bot1/groups", {
      param: { limit: 30 },
    })
  })

  it("listGroups includes cursor when provided", async () => {
    apiGet.mockResolvedValueOnce({ list: [] })

    await BotManageService.listGroups({
      robotId: "bot1",
      limit: 30,
      cursor: "C2",
    })

    expect(apiGet).toHaveBeenCalledWith("robot/bot1/groups", {
      param: { limit: 30, cursor: "C2" },
    })
  })

  it("enableMentionFree calls mention preference endpoint", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotManageService.enableMentionFree("bot1", "group-a")

    expect(apiPut).toHaveBeenCalledWith(
      "robot/bot1/groups/group-a/mention_pref",
      { no_mention: 1 },
    )
  })

  it("disableMentionFree deletes mention preference", async () => {
    apiDelete.mockResolvedValueOnce(undefined)

    await BotManageService.disableMentionFree("bot1", "group-a")

    expect(apiDelete).toHaveBeenCalledWith(
      "robot/bot1/groups/group-a/mention_pref",
    )
  })
})
