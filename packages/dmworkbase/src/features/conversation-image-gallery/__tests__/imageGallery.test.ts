import { describe, expect, it } from "vitest";
import { MessageStatus, TaskStatus } from "wukongimjssdk";
import { MessageContentTypeConst } from "../../../Service/Const";
import {
  collectGalleryImages,
  imageGalleryKey,
  type GalleryMessage,
} from "../imageGallery";

const options = { resolveUrl: (url: string) => `https://cdn.example/${url}` };
const message = (
  id: string,
  overrides: Partial<GalleryMessage> = {}
): GalleryMessage => ({
  clientMsgNo: id,
  messageID: `server-${id}`,
  status: MessageStatus.Normal,
  contentType: MessageContentTypeConst.image,
  content: { url: `${id}.png`, name: `${id}.png` },
  ...overrides,
});

describe("collectGalleryImages", () => {
  it("preserves display order and flattens groups with original attachment indices", () => {
    const group = message("group", {
      content: {
        images: [
          { url: "a.png", width: 300, height: 200, name: "a.png" },
          { url: "" },
          null,
          { remoteUrl: "b.png", name: "b.png" },
        ],
      },
    });
    const images = collectGalleryImages(
      [
        message("first"),
        message("text", { contentType: 1 }),
        group,
        message("last"),
      ],
      options
    );
    expect(images.map((image) => image.filename)).toEqual([
      "first.png",
      "a.png",
      "b.png",
      "last.png",
    ]);
    expect(images[1]).toMatchObject({
      key: imageGalleryKey(group, 0),
      width: 300,
      height: 200,
    });
    expect(images[2].key).toBe(imageGalleryKey(group, 3));
  });

  it("retains repeated URLs and deduplicates only repeated message attachment identities", () => {
    const a = message("a", { content: { url: "same.png" } });
    const b = message("b", { content: { url: "same.png" } });
    const images = collectGalleryImages([a, a, b], options);
    expect(images).toHaveLength(2);
    expect(images[0].src).toBe(images[1].src);
    expect(images[0].key).not.toBe(images[1].key);
  });

  it.each([
    { status: MessageStatus.Wait },
    { status: MessageStatus.Fail },
    { revoke: true },
    { remoteExtra: { revoke: true } },
    { flame: true },
    { isDeleted: true },
    { message: { isDeleted: true } },
    { content: { url: "x.png", contentObj: { flame: 1 } } },
    { content: { imgData: "data:image/png;base64,a" } },
    { content: { url: "blob:pending" } },
    { content: { url: "   " } },
    { content: undefined },
    { clientMsgNo: "", messageID: "" },
  ])("excludes ineligible live images: %j", (overrides) => {
    expect(collectGalleryImages([message("a", overrides)], options)).toEqual(
      []
    );
  });

  it.each([
    TaskStatus.wait,
    TaskStatus.processing,
    TaskStatus.fail,
    TaskStatus.cancel,
    TaskStatus.suspend,
  ])(
    "excludes an image with upload task status %s even if a URL exists",
    (status) => {
      expect(
        collectGalleryImages([message("a")], {
          ...options,
          getUploadStatus: () => status,
        })
      ).toEqual([]);
    }
  );

  it("accepts a completed upload and falls back to server identity", () => {
    const image = message("a", { clientMsgNo: "" });
    expect(
      collectGalleryImages([image], {
        ...options,
        getUploadStatus: () => TaskStatus.success,
      })[0].key
    ).toBe(imageGalleryKey(image, 0));
  });

  it("skips URLs the data source cannot resolve", () => {
    expect(
      collectGalleryImages([message("a")], { resolveUrl: () => "" })
    ).toEqual([]);
  });

  it("uses archived order/position when forwarded messages have no delivery state or ID", () => {
    const a = message("a", {
      clientMsgNo: "",
      messageID: "",
      status: MessageStatus.Wait,
    });
    const b = message("b", {
      clientMsgNo: "",
      messageID: "",
      status: MessageStatus.Wait,
    });
    const images = collectGalleryImages([a, b], {
      ...options,
      forwarded: true,
    });
    expect(images.map((image) => image.key)).toEqual([
      imageGalleryKey(a, 0, 0),
      imageGalleryKey(b, 0, 1),
    ]);
    expect(
      collectGalleryImages(
        [message("revoked", { remoteExtra: { revoke: true } })],
        { ...options, forwarded: true }
      )
    ).toEqual([]);
  });
});
