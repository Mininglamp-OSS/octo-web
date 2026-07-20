import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../APIClient", () => ({
  default: {
    shared: {
      post: vi.fn(),
    },
  },
}))

import APIClient from "../APIClient"
import ThreadService from "../ThreadService"

const apiPost = APIClient.shared.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  apiPost.mockReset()
})

describe("ThreadService", () => {
  it("createThreadByName posts a name-only create request", async () => {
    const thread = { short_id: "t1", name: "Topic" }
    apiPost.mockResolvedValueOnce(thread)

    await expect(ThreadService.createThreadByName("group-a", "Topic")).resolves.toEqual({
      ...thread,
      group_no: "group-a",
      channel_id: "group-a____t1",
    })
    expect(apiPost).toHaveBeenCalledWith("groups/group-a/threads", {
      name: "Topic",
    })
  })

  it("createThreadByName keeps legacy sourceMessageId support", async () => {
    apiPost.mockResolvedValueOnce({ short_id: "t2" })

    await ThreadService.createThreadByName("group-a", "Topic", 456)
    expect(apiPost).toHaveBeenCalledWith("groups/group-a/threads", {
      name: "Topic",
      source_message_id: 456,
    })
  })

  it("createThreadByName preserves returned channel_id when present", async () => {
    const response = { channel_id: "group-a____t3", short_id: "t3", name: "Topic" }
    apiPost.mockResolvedValueOnce(response)

    await expect(ThreadService.createThreadByName("group-a", "Topic")).resolves.toEqual({
      ...response,
      group_no: "group-a",
    })
  })

  it("createThreadFromMessage posts source message metadata", async () => {
    const payload = { type: 1, content: "hello" }
    const response = { channel_id: "group-a____t1", short_id: "t1" }
    apiPost.mockResolvedValueOnce(response)

    await expect(
      ThreadService.createThreadFromMessage({
        groupNo: "group-a",
        name: "Topic",
        sourceMessageId: 123,
        sourceMessagePayload: payload,
      })
    ).resolves.toEqual(response)

    expect(apiPost).toHaveBeenCalledWith("groups/group-a/threads", {
      name: "Topic",
      source_message_id: 123,
      source_message_payload: payload,
    })
  })
})
