import { describe, expect, it } from "vitest";
import {
  subchannelOpenFromMount,
  subchannelOpenFromThreadChange,
} from "../subchannelOpenTracking";
import { ChannelTypeCommunityTopic } from "../Const";
import { buildThreadChannelId, type Thread } from "../Thread";

const ChannelTypeGroup = 2; // wukongimjssdk 口径,子区页挂载分支的对照类型

// #1452 R10:subchannel_opened 采集决策的行为单测(替代 dapEventCoverage 里的源码正则钉)。
// 覆盖 P1-1(两入口去重)/ P2-1(channel_id strip)。

const SPACE = "s" + "a".repeat(32); // s<32hex>
const thread = (over: Partial<Thread> = {}): Thread =>
  ({
    short_id: "t42",
    group_no: "g100",
    channel_id: buildThreadChannelId("g100", "t42"),
    channel_type: ChannelTypeCommunityTopic,
    name: "x",
    creator_uid: "u1",
    status: 1,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Thread;

describe("subchannelOpenFromThreadChange(入口二:页内子区选择)", () => {
  it("activeThread 身份从 null 变为某子区 → 发点,channel_id=bare group_no", () => {
    const r = subchannelOpenFromThreadChange(thread(), undefined);
    expect(r).toEqual({ channel_id: "g100", subchannel_id: "t42" });
  });

  it("channel_id 未变(同一子区重渲染) → 不发", () => {
    const cur = thread();
    expect(
      subchannelOpenFromThreadChange(cur, cur.channel_id)
    ).toBeNull();
  });

  it("activeThread 为 null(关闭子区) → 不发", () => {
    expect(subchannelOpenFromThreadChange(null, "prev")).toBeNull();
  });

  it("group_no 带 Space 前缀 → stripSpacePrefix 归一为 bare", () => {
    const r = subchannelOpenFromThreadChange(
      thread({ group_no: `${SPACE}_g100` }),
      undefined
    );
    expect(r?.channel_id).toBe("g100");
  });

  it("缺 short_id → 不发(判空)", () => {
    expect(
      subchannelOpenFromThreadChange(thread({ short_id: "" }), undefined)
    ).toBeNull();
  });
});

describe("subchannelOpenFromMount(入口一:以子区频道挂载)", () => {
  const channel = (channelID: string, channelType = ChannelTypeCommunityTopic) =>
    ({ channelID, channelType }) as { channelID: string; channelType: number };

  it("以子区频道挂载且无 sentinel → 发点(列表/深链直开)", () => {
    const r = subchannelOpenFromMount(
      channel(buildThreadChannelId("g100", "t42")),
      "g100",
      undefined
    );
    expect(r).toEqual({ channel_id: "g100", subchannel_id: "t42" });
  });

  it("P1-1:sentinel 命中同一 channelID → 不发(避免 didUpdate 已发后再重复)", () => {
    const cid = buildThreadChannelId("g100", "t42");
    expect(subchannelOpenFromMount(channel(cid), "g100", cid)).toBeNull();
  });

  it("sentinel 是别的 channelID → 照发(不误伤无关子区挂载)", () => {
    const cid = buildThreadChannelId("g100", "t42");
    const r = subchannelOpenFromMount(channel(cid), "g100", "someOther____x");
    expect(r).toEqual({ channel_id: "g100", subchannel_id: "t42" });
  });

  it("P2-1:parentGroupNo 带 Space 前缀 → strip 为 bare", () => {
    const r = subchannelOpenFromMount(
      channel(buildThreadChannelId("g100", "t42")),
      `${SPACE}_g100`,
      undefined
    );
    expect(r?.channel_id).toBe("g100");
  });

  it("非子区频道(群) → 不发", () => {
    expect(
      subchannelOpenFromMount(channel("g100", ChannelTypeGroup), "g100", undefined)
    ).toBeNull();
  });

  it("缺 parentGroupNo → 不发", () => {
    expect(
      subchannelOpenFromMount(
        channel(buildThreadChannelId("g100", "t42")),
        undefined,
        undefined
      )
    ).toBeNull();
  });

  it("channelID 非合法子区复合 id(parse 不出 shortId) → 不发", () => {
    expect(
      subchannelOpenFromMount(channel("not-a-thread-id"), "g100", undefined)
    ).toBeNull();
  });
});
