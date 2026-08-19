import { beforeEach, describe, expect, it, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
  mittBusEmit: vi.fn(),
  createThreadByName: vi.fn(),
  dapTrack: vi.fn(),
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

vi.mock("../../../Service/Dap", () => ({
  Dap: { shared: { track: hoisted.dapTrack } },
}))

import { createThreadByNameAndNotify, emitThreadCreated, trackSubchannelCreated } from "../createThread"

beforeEach(() => {
  hoisted.mittBusEmit.mockReset()
  hoisted.createThreadByName.mockReset()
  hoisted.dapTrack.mockReset()
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

  it("带 sourceMessageId → subchannel_created.source = message_right_click(消息发起,不再硬编码 toolbar)", async () => {
    hoisted.createThreadByName.mockResolvedValueOnce({ short_id: "t3", channel_id: "group-a____t3" })

    await createThreadByNameAndNotify("group-a", "Topic", 789)

    expect(hoisted.dapTrack).toHaveBeenCalledWith(
      "subchannel_created",
      expect.objectContaining({ source: "message_right_click", subchannel_id: "t3", channel_id: "group-a" })
    )
  })

  it("不带 sourceMessageId → subchannel_created.source = channel_toolbar(顶栏)", async () => {
    hoisted.createThreadByName.mockResolvedValueOnce({ short_id: "t4", channel_id: "group-a____t4" })

    await createThreadByNameAndNotify("group-a", "Topic")

    expect(hoisted.dapTrack).toHaveBeenCalledWith(
      "subchannel_created",
      expect.objectContaining({ source: "channel_toolbar", subchannel_id: "t4" })
    )
  })
})

describe("trackSubchannelCreated 关键属性", () => {
  it("顶栏路径带 channel_id(父群) + subchannel_id + source + title_len_bucket,不带 from_msg_type", () => {
    trackSubchannelCreated({ short_id: "t1", channel_id: "group-a____t1" } as any, "channel_toolbar", {
      title: "Topic",
      channelId: "group-a",
    })
    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", {
      subchannel_id: "t1",
      source: "channel_toolbar",
      title_len_bucket: "short",
      channel_id: "group-a",
    })
  })

  it("右键路径额外带 from_msg_type,channel_id = 源消息所在群", () => {
    trackSubchannelCreated({ short_id: "t2", channel_id: "group-b____t2" } as any, "message_right_click", {
      title: "",
      fromMsgType: "image_file",
      channelId: "group-b",
    })
    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", {
      subchannel_id: "t2",
      source: "message_right_click",
      title_len_bucket: "empty",
      from_msg_type: "image_file",
      channel_id: "group-b",
    })
  })

  it("resp 为 null 时不发(fail-closed,不误判创建失败)", () => {
    trackSubchannelCreated(null, "channel_toolbar", { title: "x", channelId: "group-a" })
    expect(hoisted.dapTrack).not.toHaveBeenCalled()
  })
})
