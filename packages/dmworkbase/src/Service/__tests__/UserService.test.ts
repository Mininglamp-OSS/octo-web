import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      get: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import UserService from "../UserService"

const apiGet = APIClient.shared.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiGet.mockReset()
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
})
