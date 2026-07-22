// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Channel,
  ChannelTypeGroup,
  Mention,
  Message,
  MessageText,
} from "wukongimjssdk";

vi.mock("../../App", () => ({
  default: {
    loginInfo: { uid: "me" },
    emojiService: { getImage: () => undefined },
    dataSource: {
      channelDataSource: { subscribers: () => Promise.resolve([]) },
    },
  },
}));

vi.mock("../../i18n", () => ({
  t: (key: string) => key,
}));

import { MessageContentTypeConst } from "../../Service/Const";
import { MessageWrap } from "../../Service/Model";
import { MENTION_UID_HUMANS } from "../../Utils/mentionRender";
import {
  RichTextBlockType,
  RichTextContent,
} from "../RichText/RichTextContent";
import {
  canReeditRevokedMessage,
  getReeditableMessageBlocks,
} from "./reeditableMessage";

function makeMessage(content: MessageText | RichTextContent): MessageWrap {
  const message = new Message();
  message.channel = new Channel("group", ChannelTypeGroup);
  message.fromUID = "me";
  message.content = content;
  message.remoteExtra.revoke = true;
  message.remoteExtra.revoker = "me";
  return new MessageWrap(message);
}

describe("revoked message re-editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only allows the original sender to re-edit a message they revoked", () => {
    const message = makeMessage(new MessageText("fix this"));

    expect(canReeditRevokedMessage(message, "me")).toBe(true);

    message.message.remoteExtra.revoker = "admin";
    expect(canReeditRevokedMessage(message, "me")).toBe(false);

    message.message.remoteExtra.revoker = "me";
    message.message.fromUID = "member";
    expect(canReeditRevokedMessage(message, "me")).toBe(false);
  });

  it("restores multiline text and ordinary mentions as editor nodes", () => {
    const content = new MessageText("Hi @Alice\nplease review");
    const mention = new Mention();
    mention.uids = ["alice"];
    (
      mention as Mention & {
        entities: Array<{ uid: string; offset: number; length: number }>;
      }
    ).entities = [{ uid: "alice", offset: 3, length: 6 }];
    content.mention = mention;
    const [block] = getReeditableMessageBlocks(makeMessage(content));

    expect(block).toEqual({
      type: "content",
      content: [
        { type: "text", text: "Hi " },
        { type: "mention", attrs: { id: "alice", label: "Alice" } },
        { type: "hardBreak" },
        { type: "text", text: "please review" },
      ],
    });
  });

  it("restores a trusted broadcast mention as the composer sentinel", () => {
    const content = new MessageText("@所有人 请看");
    const mention = new Mention();
    mention.all = true;
    content.mention = mention;
    const [block] = getReeditableMessageBlocks(makeMessage(content));

    expect(block).toEqual({
      type: "content",
      content: [
        {
          type: "mention",
          attrs: { id: MENTION_UID_HUMANS, label: "所有人" },
        },
        { type: "text", text: " 请看" },
      ],
    });
  });

  it("keeps rich-text block order and restores images", () => {
    const content = new RichTextContent();
    content.content = [
      { type: RichTextBlockType.text, text: "before" },
      {
        type: RichTextBlockType.image,
        url: "https://example.com/image.png",
        width: 640,
        height: 480,
      },
      { type: RichTextBlockType.text, text: "after" },
    ];
    const message = makeMessage(content);
    expect(message.contentType).toBe(MessageContentTypeConst.richText);

    expect(getReeditableMessageBlocks(message)).toEqual([
      { type: "content", content: [{ type: "text", text: "before" }] },
      {
        type: "image",
        url: "https://example.com/image.png",
        width: 640,
        height: 480,
        size: undefined,
        name: undefined,
        mime: undefined,
      },
      { type: "content", content: [{ type: "text", text: "after" }] },
    ]);
  });
});
