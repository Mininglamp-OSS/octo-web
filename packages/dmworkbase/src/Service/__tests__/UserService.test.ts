import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import UserService from "../UserService"

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>
const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>
const apiPut = APIClient.shared.put as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiGet.mockReset()
  apiPost.mockReset()
  apiPut.mockReset()
})

describe("UserService", () => {
  it("getUserProfile calls users/:uid with empty group_no by default", async () => {
    const profile = { uid: "u1", name: "User 1" }
    apiGet.mockResolvedValueOnce(profile)

    await expect(UserService.getUserProfile("u1")).resolves.toEqual(profile)
    expect(apiGet).toHaveBeenCalledWith("users/u1", {
      param: { group_no: "" },
    })
  })

  it("getUserProfile passes group_no when provided", async () => {
    apiGet.mockResolvedValueOnce({ uid: "u2" })

    await UserService.getUserProfile("u2", "group-a")
    expect(apiGet).toHaveBeenCalledWith("users/u2", {
      param: { group_no: "group-a" },
    })
  })

  it("normalizes blank groupNo to empty string", async () => {
    apiGet.mockResolvedValueOnce({ uid: "u3" })

    await UserService.getUserProfile("u3", "")
    expect(apiGet).toHaveBeenCalledWith("users/u3", {
      param: { group_no: "" },
    })
  })

  it("updateRemark calls friend remark endpoint", async () => {
    apiPut.mockResolvedValueOnce(undefined)

    await UserService.updateRemark("u4", "Nick")

    expect(apiPut).toHaveBeenCalledWith("friend/remark", {
      uid: "u4",
      remark: "Nick",
    })
  })

  it("applyFriend includes vercode and space when provided", async () => {
    apiPost.mockResolvedValueOnce(undefined)

    await UserService.applyFriend({
      uid: "u5",
      remark: "hello",
      vercode: "v1",
      spaceId: "space-a",
    })

    expect(apiPost).toHaveBeenCalledWith("friend/apply", {
      to_uid: "u5",
      remark: "hello",
      vercode: "v1",
      space_id: "space-a",
    })
  })

  it("applyFriend normalizes missing vercode and omits blank space", async () => {
    apiPost.mockResolvedValueOnce(undefined)

    await UserService.applyFriend({
      uid: "u6",
      remark: "hello",
      spaceId: "",
    })

    expect(apiPost).toHaveBeenCalledWith("friend/apply", {
      to_uid: "u6",
      remark: "hello",
      vercode: "",
    })
  })
})
