import { describe, it, expect, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  class StubMessageContent {
    contentObj: any;
    contentType!: number;
    encodeJSON(): any {
      return {};
    }
    decode(raw: Uint8Array) {
      this.contentObj = JSON.parse(new TextDecoder().decode(raw));
      // contentType may be a read-only getter on subclasses (e.g. MergeforwardContent)
      try { this.contentType = this.contentObj?.type ?? 0; } catch (_e) {}
      // Mirror real SDK: MessageContent.decode() calls decodeJSON()
      if (typeof (this as any).decodeJSON === "function") {
        (this as any).decodeJSON(this.contentObj);
      }
    }
    get conversationDigest() {
      return "";
    }
  }

  class StubMessage {
    messageID: string = "";
    timestamp: number = 0;
    fromUID: string = "";
    content: any;
  }

  // Configurable factory so tests can inject real MergeforwardContent for type=11
  let contentFactory: (type: number) => any = (type) => {
    return new StubMessageContent();
  };

  const getMessageContent = vi.fn((type: number) => contentFactory(type));

  return {
    StubMessageContent,
    StubMessage,
    getMessageContent,
    setContentFactory: (f: (type: number) => any) => {
      contentFactory = f;
    },
  };
});

vi.mock("wukongimjssdk", () => ({
  Channel: class {
    channelID: string;
    channelType: number;
    constructor(channelID: string, channelType: number) {
      this.channelID = channelID;
      this.channelType = channelType;
    }
  },
  ChannelTypeGroup: 2,
  ChannelTypePerson: 1,
  Message: hoisted.StubMessage,
  MessageContent: hoisted.StubMessageContent,
  Mention: class {
    all: boolean = false;
    uids: string[] = [];
  },
  Reply: class {
    fromUID: string = "";
    messageID: string = "";
    content: any = null;
    decode(data: any) {
      this.fromUID = data?.from_uid ?? "";
      this.messageID = data?.message_id ?? "";
    }
  },
  WKSDK: {
    shared: () => ({
      getMessageContent: hoisted.getMessageContent,
      channelManager: {
        getChannelInfo: () => undefined,
        fetchChannelInfo: () => undefined,
      },
    }),
  },
}));

vi.mock("../../../Components/MergeforwardMessageList", () => ({
  default: () => null,
}));
vi.mock("../../Base", () => ({ default: () => null }));
vi.mock("../../Base/tail", () => ({ default: () => null }));
vi.mock("../../MessageCell", () => ({ MessageCell: class {} }));
vi.mock("../../../ui/message/MessageRow", () => ({ default: () => null }));
vi.mock("../../../ui/message/MergeforwardCard", () => ({ default: () => null }));
vi.mock("../../../bridge/message/useMergeforwardMessageUI", () => ({
  getMergeforwardMessageUI: () => null,
}));
vi.mock("../../../Components/WKModal", () => ({ default: () => null }));
vi.mock("@douyinfe/semi-ui", () => ({
  Modal: () => null,
  Popconfirm: ({ children }: any) => children ?? null,
}));
vi.mock("@douyinfe/semi-icons", () => ({
  default: () => null,
  IconAlertTriangle: () => null,
  IconArrowLeft: () => null,
  IconChevronDown: () => null,
  IconClose: () => null,
}));
vi.mock("../index.css", () => ({}));

import MergeforwardContent from "../index";

// For type=11, return a real MergeforwardContent so decodeDepth is actually exercised
hoisted.setContentFactory((type: number) => {
  if (type === 11) return new MergeforwardContent();
  const c = new hoisted.StubMessageContent();
  return c;
});

/**
 * Wire-format helper: builds a properly-shaped message map at each level.
 * Each entry in msgs[] must be { message_id, from_uid, timestamp, payload }.
 * depth=0 → leaf text message; depth=N → merge-forward wrapping depth=N-1.
 */
function createNestedMsgMap(depth: number): any {
  if (depth === 0) {
    return {
      message_id: "leaf",
      from_uid: "u0",
      timestamp: 0,
      payload: { type: 1, content: "Hello" },
    };
  }
  return {
    message_id: `n${depth}`,
    from_uid: `u${depth}`,
    timestamp: depth,
    payload: {
      type: 11,
      channel_type: 2,
      users: [{ uid: `u${depth}`, name: `User${depth}` }],
      msgs: [createNestedMsgMap(depth - 1)],
    },
  };
}

describe("MergeforwardContent depth limit", () => {
  it("shallow nesting (depth=4) decodes all levels without truncation", () => {
    const content = new MergeforwardContent();
    content.decodeJSON(createNestedMsgMap(4).payload);

    expect(content.msgs).toHaveLength(1);

    // Walk down and confirm every level decoded its one message
    let cur: MergeforwardContent = content;
    for (let i = 0; i < 3; i++) {
      const inner = cur.msgs[0].content;
      expect(inner).toBeInstanceOf(MergeforwardContent);
      expect((inner as MergeforwardContent).msgs).toHaveLength(1);
      cur = inner as MergeforwardContent;
    }
  });

  it("depth=8 (at limit) decodes without truncation", () => {
    const content = new MergeforwardContent();
    content.decodeJSON(createNestedMsgMap(8).payload);

    expect(content.msgs).toHaveLength(1);
    // The deepest level still has its one nested message
    let cur: MergeforwardContent = content;
    let levels = 0;
    while (
      cur.msgs.length > 0 &&
      cur.msgs[0].content instanceof MergeforwardContent
    ) {
      cur = cur.msgs[0].content as MergeforwardContent;
      levels++;
    }
    // 7 inner MergeforwardContent levels below the root (total depth = 8)
    expect(levels).toBe(7);
  });

  it("depth=9 (one over limit) truncates at the 9th level deterministically", () => {
    const content = new MergeforwardContent();
    content.decodeJSON(createNestedMsgMap(9).payload);

    // Root and first 8 inner levels should have msgs
    let cur: MergeforwardContent = content;
    for (let i = 0; i < 8; i++) {
      expect(cur.msgs).toHaveLength(1);
      expect(cur.msgs[0].content).toBeInstanceOf(MergeforwardContent);
      cur = cur.msgs[0].content as MergeforwardContent;
    }

    // The 9th inner MergeforwardContent hits MAX_DECODE_DEPTH and must have msgs=[]
    expect(cur.msgs).toHaveLength(0);
  });

  it("very deep nesting (depth=20) does not throw", () => {
    const content = new MergeforwardContent();
    expect(() => content.decodeJSON(createNestedMsgMap(20).payload)).not.toThrow();
    expect(content.msgs).toHaveLength(1);
  });

  it("decodeDepth resets to 0 after decodeJSON (counter cleanup via finally)", () => {
    const content = new MergeforwardContent();
    content.decodeJSON(createNestedMsgMap(20).payload);

    // A second call at depth=1 should not be affected by the previous call
    const second = new MergeforwardContent();
    second.decodeJSON(createNestedMsgMap(4).payload);
    expect(second.msgs).toHaveLength(1);
  });
});

describe("MergeforwardContent decode() SDK metadata hydration", () => {
  it("preserves mention fields from payload", () => {
    const raw = new TextEncoder().encode(JSON.stringify({
      type: 11,
      channel_type: 1,
      users: [],
      msgs: [],
      mention: { all: 1, uids: ["u1", "u2"] },
    }));
    const content = new MergeforwardContent();
    content.decode(raw);
    expect(content.mention).toBeDefined();
    expect(content.mention.all).toBe(true);
    expect(content.mention.uids).toEqual(["u1", "u2"]);
  });

  it("preserves reply field from payload", () => {
    const raw = new TextEncoder().encode(JSON.stringify({
      type: 11,
      channel_type: 1,
      users: [],
      msgs: [],
      reply: { from_uid: "u1", message_id: "999" },
    }));
    const content = new MergeforwardContent();
    content.decode(raw);
    expect(content.reply).toBeDefined();
    expect(content.reply.fromUID).toBe("u1");
    expect(content.reply.messageID).toBe("999");
  });

  it("preserves visibles and invisibles from payload", () => {
    const raw = new TextEncoder().encode(JSON.stringify({
      type: 11,
      channel_type: 1,
      users: [],
      msgs: [],
      visibles: ["u1"],
      invisibles: ["u2"],
    }));
    const content = new MergeforwardContent();
    content.decode(raw);
    expect((content as any).visibles).toEqual(["u1"]);
    expect((content as any).invisibles).toEqual(["u2"]);
  });

  it("sets contentObj and decodes msgs on valid payload", () => {
    const payload = { type: 11, channel_type: 2, users: [{ uid: "u1", name: "User1" }], msgs: [] };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const content = new MergeforwardContent();
    content.decode(raw);
    expect(content.contentObj).toMatchObject({ type: 11 });
    expect(content.msgs).toEqual([]);
    expect(content.users).toHaveLength(1);
  });

  it("sets contentObj to {} and returns cleanly on invalid JSON", () => {
    const raw = new TextEncoder().encode("not valid json {{{");
    const content = new MergeforwardContent();
    expect(() => content.decode(raw)).not.toThrow();
    expect(content.contentObj).toEqual({});
    // Safe defaults must be applied so downstream consumers don't hit undefined
    expect(content.channelType).toBe(0);
    expect(content.users).toEqual([]);
    expect(content.msgs).toEqual([]);
  });
});

describe("MergeforwardContent decode() Path 1 regression — TextDecoder, not String.fromCharCode.apply", () => {
  it("does not call the SDK base MessageContent.decode (verifies TextDecoder path is active)", () => {
    const baseDecode = vi.spyOn(hoisted.StubMessageContent.prototype, "decode");
    const raw = new TextEncoder().encode(JSON.stringify({
      type: 11, channel_type: 1, users: [], msgs: [],
    }));
    const content = new MergeforwardContent();
    content.decode(raw);
    expect(baseDecode).not.toHaveBeenCalled();
    baseDecode.mockRestore();
  });

  it("handles a large payload (~200KB) without stack overflow", () => {
    // String.fromCharCode.apply(null, data) overflows for large Uint8Arrays;
    // TextDecoder handles them safely. Generate ~200KB by using many users.
    const users = Array.from({ length: 8000 }, (_, i) => ({ uid: `u${i}`, name: `User ${i} `.repeat(3) }));
    const raw = new TextEncoder().encode(JSON.stringify({
      type: 11, channel_type: 2, users, msgs: [],
    }));
    expect(raw.length).toBeGreaterThan(200_000);
    const content = new MergeforwardContent();
    expect(() => content.decode(raw)).not.toThrow();
    expect(content.users.length).toBeGreaterThan(0);
  });
});
