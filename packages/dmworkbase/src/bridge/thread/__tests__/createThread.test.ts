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

import { MessageContentType } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../../Service/Const"
import { createThreadByNameAndNotify, emitThreadCreated, inferMsgType, trackSubchannelCreated } from "../createThread"

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

  it("带 sourceMessageId 仍 → subchannel_created.source = channel_toolbar(本桥恒顶栏,不再按源消息推断)", async () => {
    hoisted.createThreadByName.mockResolvedValueOnce({ short_id: "t3", channel_id: "group-a____t3" })

    await createThreadByNameAndNotify("group-a", "Topic", 789)

    expect(hoisted.dapTrack).toHaveBeenCalledWith(
      "subchannel_created",
      expect.objectContaining({ source: "channel_toolbar", subchannel_id: "t3", channel_id: "group-a" })
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

  it("右键路径额外带 from_msg_type + is_ai_msg,channel_id = 源消息所在群", () => {
    trackSubchannelCreated({ short_id: "t2", channel_id: "group-b____t2" } as any, "message_right_click", {
      title: "",
      fromMsgType: "image_file",
      channelId: "group-b",
      isAiMsg: true,
    })
    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", {
      subchannel_id: "t2",
      source: "message_right_click",
      title_len_bucket: "empty",
      from_msg_type: "image_file",
      channel_id: "group-b",
      is_ai_msg: true,
    })
  })

  it("is_ai_msg 携带 false(源消息作者非 AI)而非省略", () => {
    trackSubchannelCreated({ short_id: "t2b", channel_id: "group-b____t2b" } as any, "message_right_click", {
      title: "hi",
      fromMsgType: "text",
      channelId: "group-b",
      isAiMsg: false,
    })
    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", {
      subchannel_id: "t2b",
      source: "message_right_click",
      title_len_bucket: "short",
      from_msg_type: "text",
      channel_id: "group-b",
      is_ai_msg: false,
    })
  })

  it("resp 为 null 时不发(fail-closed,不误判创建失败)", () => {
    trackSubchannelCreated(null, "channel_toolbar", { title: "x", channelId: "group-a" })
    expect(hoisted.dapTrack).not.toHaveBeenCalled()
  })

  it("uses parsed short_id or channel_id as a fallback and omits absent channel_id", () => {
    trackSubchannelCreated({ channel_id: "group-a____parsed" } as any, "channel_toolbar", {
      title: "12345678901",
    })
    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", {
      subchannel_id: "parsed",
      source: "channel_toolbar",
      title_len_bucket: "medium",
    })
  })

  it("does not track when the response has no usable subchannel id", () => {
    trackSubchannelCreated({} as any, "channel_toolbar", { title: "Topic" })

    expect(hoisted.dapTrack).not.toHaveBeenCalled()
  })

  it("strips a Space prefix from the parent channel_id", () => {
    trackSubchannelCreated({ short_id: "t3" } as any, "channel_toolbar", {
      title: "a".repeat(31),
      channelId: "sa1b2c3d4e5f60718293a4b5c6d7e8f90_group-a",
    })

    expect(hoisted.dapTrack).toHaveBeenCalledWith("subchannel_created", expect.objectContaining({
      subchannel_id: "t3",
      title_len_bucket: "long",
      channel_id: "group-a",
    }))
  })
})

describe("inferMsgType", () => {
  it("prioritizes reply metadata over the underlying text type", () => {
    expect(inferMsgType({
      content: { contentType: MessageContentType.text, reply: { messageID: "m1" } },
    })).toBe("reply")
  })

  it("maps text, image/file, interactive card, and unknown content", () => {
    expect(inferMsgType({ contentType: MessageContentType.text })).toBe("text")
    expect(inferMsgType({ contentType: MessageContentType.image })).toBe("image_file")
    expect(inferMsgType({ contentType: MessageContentTypeConst.file })).toBe("image_file")
    expect(inferMsgType({ contentType: MessageContentTypeConst.interactiveCard })).toBe("link")
    expect(inferMsgType(undefined)).toBeUndefined()
  })
})
