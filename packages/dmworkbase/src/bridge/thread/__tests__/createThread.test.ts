import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  mittBusEmit: vi.fn(),
  createThreadByName: vi.fn(),
}))

vi.mock("../../../App", () => ({
  default: {
    mittBus: {
      emit: hoisted.mittBusEmit,
    },
  },
}))

vi.mock("../../../Service/ThreadService", () => ({
  default: {
    createThreadByName: hoisted.createThreadByName,
  },
}))

import { createThreadByNameAndNotify, emitThreadCreated } from "../createThread"

beforeEach(() => {
  hoisted.mittBusEmit.mockReset()
  hoisted.createThreadByName.mockReset()
})

describe("createThread bridge", () => {
  it("creates a thread through ThreadService and emits wk:thread-created", async () => {
    const thread = {
      short_id: "t1",
      channel_id: "group-a____t1",
      group_no: "group-a",
      name: "Topic",
    }
    hoisted.createThreadByName.mockResolvedValueOnce(thread)

    await expect(createThreadByNameAndNotify("group-a", "Topic", 456)).resolves.toEqual(thread)

    expect(hoisted.createThreadByName).toHaveBeenCalledWith("group-a", "Topic", 456)
    expect(hoisted.mittBusEmit).toHaveBeenCalledWith("wk:thread-created", {
      groupNo: "group-a",
      shortId: "t1",
      threadChannelId: "group-a____t1",
      thread,
    })
  })

  it("builds threadChannelId from short_id when channel_id is absent", () => {
    const thread = { short_id: "t2", name: "Topic" }

    emitThreadCreated("group-a", thread)

    expect(hoisted.mittBusEmit).toHaveBeenCalledWith("wk:thread-created", {
      groupNo: "group-a",
      shortId: "t2",
      threadChannelId: "group-a____t2",
      thread,
    })
  })

  it("skips the event when no thread channel id can be resolved", () => {
    emitThreadCreated("group-a", { name: "Topic" })

    expect(hoisted.mittBusEmit).not.toHaveBeenCalled()
  })
})
