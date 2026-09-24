import { describe, expect, it } from "vitest";
import { MessageStatus } from "wukongimjssdk";
import { RichTextContent } from "../../../Messages/RichText/RichTextContent";
import { collectGalleryImages, imageGalleryKey } from "../imageGallery";

const options = { resolveUrl: (url: string) => url };
function richMessage() {
  const content = new RichTextContent();
  content.decodeJSON({
    content: [
      { type: "text", text: "Before" },
      {
        type: "image",
        url: "https://cdn/a.png",
        name: "a.png",
        width: 320,
        height: 200,
      },
      { type: "image", url: "" },
      { type: "file", url: "https://cdn/file.png", name: "file.png" },
      { type: "text", text: "Between" },
      { type: "image", url: "https://cdn/a.png", name: "second.png" },
    ],
  });
  return {
    contentType: 14,
    content,
    clientMsgNo: "rich",
    status: MessageStatus.Normal,
  };
}

describe("rich-text gallery images", () => {
  it("interleaves decoded rich-text blocks with ordinary images and preserves repeated URLs and block indices", () => {
    const message = richMessage();
    const ordinary = (id: string) => ({
      contentType: 2,
      clientMsgNo: id,
      content: { url: `https://cdn/${id}.png`, name: `${id}.png` },
    });
    const slides = collectGalleryImages(
      [ordinary("before"), message, ordinary("after")],
      options
    );
    expect(slides.map((slide) => slide.filename)).toEqual([
      "before.png",
      "a.png",
      "second.png",
      "after.png",
    ]);
    expect(slides[1]).toMatchObject({
      key: imageGalleryKey(message, 1),
      width: 320,
      height: 200,
    });
    expect(slides[2].key).toBe(imageGalleryKey(message, 5));
  });

  it("rejects unresolved and unsafe rich-text URLs using the inline renderer's URL policy", () => {
    const message = richMessage();
    message.content.content = [
      "javascript:alert(1)",
      "data:image/png;base64,x",
      "blob:local",
      "file:///tmp/a",
      "relative.png",
      "https://cdn/valid.png",
    ].map((url) => ({ type: "image", url }));
    expect(
      collectGalleryImages([message], options).map((slide) => slide.src)
    ).toEqual(["https://cdn/valid.png"]);
  });

  it("resolves image references before applying URL safety checks", () => {
    const message = richMessage();
    message.content.content = [{ type: "image", url: "chat/a.png" }];
    expect(
      collectGalleryImages([message], {
        resolveUrl: (url) => `https://cdn/${url}`,
      })[0]?.src
    ).toBe("https://cdn/chat/a.png");
  });

  it.each([
    { status: MessageStatus.Wait },
    { status: MessageStatus.Fail },
    { revoke: true },
    { remoteExtra: { revoke: true } },
    { isDeleted: true },
    { flame: true },
  ])(
    "retains eligibility exclusions for rich-text messages: %j",
    (overrides) => {
      expect(
        collectGalleryImages([{ ...richMessage(), ...overrides }], options)
      ).toEqual([]);
    }
  );

  it("preserves archive positions for rich-text messages without IDs", () => {
    const first = {
      ...richMessage(),
      clientMsgNo: "",
      status: MessageStatus.Wait,
    };
    const second = { ...first };
    const slides = collectGalleryImages([first, second], {
      ...options,
      forwarded: true,
    });
    expect(slides.map((slide) => slide.key)).toEqual([
      imageGalleryKey(first, 1, 0),
      imageGalleryKey(first, 5, 0),
      imageGalleryKey(second, 1, 1),
      imageGalleryKey(second, 5, 1),
    ]);
  });
});
