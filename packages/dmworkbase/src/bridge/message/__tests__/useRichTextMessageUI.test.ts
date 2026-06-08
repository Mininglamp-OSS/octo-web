import { describe, expect, it, vi } from "vitest";
import { RichTextImagePlaceholder } from "../../../Messages/RichText/RichTextContent";
import { getRichTextBlocksUI } from "../useRichTextMessageUI";

vi.mock("wukongimjssdk", () => ({
  MessageContent: class {
    contentObj: any;
    contentType!: number;
  },
}));

vi.mock("../../../Service/Const", () => ({
  MessageContentTypeConst: { richText: 14 },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getFileURL: (url: string) => url,
        getImageURL: (url: string) => url,
      },
    },
    emojiService: {
      emojiRegExp: () => /\[OK\]/,
      getImage: (key: string) => (key === "[OK]" ? "emoji://ok" : ""),
    },
  },
}));

vi.mock("../../../Messages/File", () => ({
  formatFileSize: (bytes: number) => `${bytes} B`,
  getExtension: (extension?: string, name?: string) =>
    extension || name?.split(".").pop() || "",
  getFileIconInfo: (extension: string) => ({
    color: "#999",
    label: extension.toUpperCase() || "FILE",
  }),
}));

vi.mock("../useMessageRow", () => ({
  getMessageRow: () => ({}),
  useMessageRow: () => ({}),
}));

describe("getRichTextBlocksUI", () => {
  it("maps global mention entity offsets back to individual text blocks", () => {
    const firstText = "hi @Alice";
    const secondText = " @Bob [OK]";
    const secondOffset = firstText.length + RichTextImagePlaceholder.length;

    const blocks = getRichTextBlocksUI(
      [
        { type: "text", text: firstText },
        { type: "image", url: "https://x/a.png" },
        { type: "text", text: secondText },
      ],
      {
        entities: [
          { uid: "alice", offset: 3, length: "@Alice".length },
          { uid: "bob", offset: secondOffset + 1, length: "@Bob".length },
        ],
        syntheticMentions: [{ name: "@所有人", uid: "all" }],
      }
    );

    expect(blocks[0]).toMatchObject({
      type: "text",
      mentions: [
        { name: "@Alice", uid: "alice" },
        { name: "@所有人", uid: "all" },
      ],
    });
    expect(blocks[2]).toMatchObject({
      type: "text",
      mentions: [
        { name: "@Bob", uid: "bob" },
        { name: "@所有人", uid: "all" },
      ],
      emojis: [{ key: "[OK]", url: "emoji://ok" }],
    });
  });
});
