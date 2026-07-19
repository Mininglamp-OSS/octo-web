import { beforeEach, describe, expect, it, vi } from "vitest"

const { get, post, put, axiosPost } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  axiosPost: vi.fn(),
}))

vi.mock("axios", () => ({
  default: {
    post: axiosPost,
  },
}))

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      get,
      post,
      put,
    },
  },
}))

import axios from "axios"
import APIClient from "../APIClient"
import BotProfileService from "../BotProfileService"

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>
const rawPost = axios.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
  apiPut.mockReset()
  rawPost.mockReset()
})

describe("BotProfileService", () => {
  it("getBotProfile calls users/:uid", async () => {
    apiGet.mockResolvedValueOnce({ uid: "bot1" })

    await expect(BotProfileService.getBotProfile("bot1")).resolves.toEqual({
      uid: "bot1",
    })

    expect(apiGet).toHaveBeenCalledWith("users/bot1")
  })

  it("updateDescription calls robot description endpoint", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotProfileService.updateDescription("bot1", "desc")

    expect(apiPut).toHaveBeenCalledWith("robot/bot1/description", {
      description: "desc",
    })
  })

  it("updateRemark calls friend remark endpoint", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await BotProfileService.updateRemark("bot1", "nick")

    expect(apiPut).toHaveBeenCalledWith("friend/remark", {
      uid: "bot1",
      remark: "nick",
    })
  })

  it("applyFriend includes space when provided", async () => {
    apiPost.mockResolvedValueOnce(undefined)

    await BotProfileService.applyFriend({
      uid: "bot1",
      remark: "apply",
      spaceId: "space-a",
    })

    expect(apiPost).toHaveBeenCalledWith("friend/apply", {
      to_uid: "bot1",
      remark: "apply",
      space_id: "space-a",
    })
  })

  it("applyFriend omits blank space", async () => {
    apiPost.mockResolvedValueOnce(undefined)

    await BotProfileService.applyFriend({
      uid: "bot1",
      remark: "apply",
      spaceId: "",
    })

    expect(apiPost).toHaveBeenCalledWith("friend/apply", {
      to_uid: "bot1",
      remark: "apply",
    })
  })

  it("uploadAvatar posts multipart form with token", async () => {
    const file = new File(["avatar"], "avatar.png", { type: "image/png" })
    rawPost.mockResolvedValueOnce({ data: {} })

    await BotProfileService.uploadAvatar("bot1", file, "token-a")

    expect(rawPost).toHaveBeenCalledWith(
      "users/bot1/avatar",
      expect.any(FormData),
      {
        headers: {
          "Content-Type": "multipart/form-data",
          token: "token-a",
        },
      },
    )
  })
})
