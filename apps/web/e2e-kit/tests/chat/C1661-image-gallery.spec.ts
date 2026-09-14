// @caseId C1661
// @spec apps/web/e2e-kit/case-specs/chat/C1661-image-gallery.md
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";
import { registerCh6ChatClearUnread } from "../../msw-handlers/ch6-chat-clear-unread";
import type { Page } from "@playwright/test";

const GROUP_ID = "gallery-1661";
const GROUP_NAME = "Image gallery test";

async function openGalleryConversation(page: Page) {
  await registerCh6ChatClearUnread(page);
  const origin = new URL(page.url()).origin;
  await page.evaluate(
    ({ origin, groupId }) => {
      const msw = (window as any).__msw;
      const image = (name: string) => ({
        type: 2,
        url: `${origin}/gallery-1661/${name}.svg`,
        name: `${name}.svg`,
        width: 320,
        height: 200,
      });
      const inner = (name: string, payload: unknown = image(name)) => ({
        message_id: name,
        timestamp: 1,
        from_uid: "e2e-user-2",
        payload,
      });
      const forwarded = {
        type: 11,
        channel_type: 2,
        users: [{ uid: "e2e-user-2", name: "Sender" }],
        msgs: [
          inner("f"),
          inner("g"),
          inner("nested", {
            type: 11,
            channel_type: 2,
            users: [{ uid: "e2e-user-2", name: "Sender" }],
            msgs: [inner("h")],
          }),
        ],
      };
      const payloads = [
        image("a"),
        { type: 1, content: "Between images" },
        image("b"),
        { type: 2, images: [{ ...image("c"), width: "320", height: "200" }, image("d")] },
        image("e"),
        forwarded,
        { ...image("private"), flame: 1 },
        { type: 1, content: "Gallery history ready" },
      ];
      msw.worker.use(
        msw.http.get(
          "*/gallery-1661/:name",
          ({ params }: any) =>
            new msw.HttpResponse(
              `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#4062bb"/><text x="160" y="115" text-anchor="middle" font-size="48" fill="white">${params.name}</text></svg>`,
              { headers: { "Content-Type": "image/svg+xml" } }
            )
        ),
        msw.http.post("*/message/channel/sync", async ({ request }: any) => {
          const body = await request.json();
          return msw.HttpResponse.json({
            messages:
              body.channel_id !== groupId
                ? []
                : payloads.map((payload, index) => ({
                    message_idstr: `gallery-${index + 1}`,
                    client_msg_no: `gallery-${index + 1}`,
                    message_seq: index + 1,
                    channel_id: groupId,
                    channel_type: 2,
                    from_uid: "e2e-user-2",
                    timestamp: 1,
                    payload,
                  })),
          });
        })
      );
    },
    { origin, groupId: GROUP_ID }
  );
  await installMockImRuntime(page, {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      { uid: "e2e-user-1", name: "Tester" },
      { uid: "e2e-user-2", name: "Sender" },
    ],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [{ channelId: GROUP_ID, channelType: 2, timestamp: 1 }],
    messages: [],
    subscribers: [],
  });
  await page.getByRole("button", { name: "会话", exact: true }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText(GROUP_NAME, { exact: true }).click();
  await expect(
    page.getByText("Gallery history ready", { exact: true })
  ).toBeVisible();
  return origin;
}

const counter = (page: Page) =>
  page.getByRole("status", { name: /已加载图片/ });
async function expectImage(page: Page, position: string, url: string) {
  await expect(counter(page)).toHaveText(position);
  const [current, total] = position.split(" / ");
  await expect(counter(page)).toHaveAccessibleName(`已加载图片，第 ${current} 张，共 ${total} 张`);
  const slide = page
    .getByRole("region", { name: "Photo gallery", exact: true })
    .getByRole("group", { name: position.replace(" / ", " of "), exact: true });
  await expect(slide.locator("img")).toHaveAttribute("src", url);
  await expect(slide.locator("img")).toHaveJSProperty("complete", true);
  await expect(slide.locator("img")).toHaveJSProperty("naturalWidth", 320);
}

test("@C1661 gallery navigates loaded image messages and downloads the visible attachment", async ({
  authedPage: page,
}, testInfo) => {
  const origin = await openGalleryConversation(page);
  const groupThumbnail = page.locator(`[data-message-seq="4"] img[src="${origin}/gallery-1661/c.svg"]`);
  await expect(groupThumbnail).toBeVisible();
  await expect(groupThumbnail).toHaveAttribute("width", "320");
  await page.locator('[data-message-seq="3"] img[alt=""]').click();
  await expectImage(page, "2 / 5", `${origin}/gallery-1661/b.svg`);
  await page.getByRole("button", { name: "下一张", exact: true }).click();
  await expectImage(page, "3 / 5", `${origin}/gallery-1661/c.svg`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("c.svg");
  await page.keyboard.press("ArrowRight");
  await expectImage(page, "4 / 5", `${origin}/gallery-1661/d.svg`);
  await page.getByRole("button", { name: "旋转", exact: true }).click();
  await page.getByRole("button", { name: "下一张", exact: true }).click();
  await expectImage(page, "5 / 5", `${origin}/gallery-1661/e.svg`);
  await expect(
    page.getByRole("button", { name: "下一张", exact: true })
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(counter(page)).toHaveCount(0);
  await page.locator('[data-message-seq="1"] img[alt=""]').click();
  await expectImage(page, "1 / 5", `${origin}/gallery-1661/a.svg`);
  await expect(
    page.getByRole("button", { name: "上一张", exact: true })
  ).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("1 / 5");
  await page.screenshot({ path: testInfo.outputPath("gallery.png") });
});

test("@C1661 merge-forward galleries stay inside the currently displayed level", async ({
  authedPage: page,
}) => {
  const origin = await openGalleryConversation(page);
  await page
    .locator('[data-message-seq="6"]')
    .getByText("聊天记录", { exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.locator(`img[src="${origin}/gallery-1661/f.svg"]`).click();
  await expectImage(page, "1 / 2", `${origin}/gallery-1661/f.svg`);
  await page.getByRole("button", { name: "下一张", exact: true }).click();
  await expectImage(page, "2 / 2", `${origin}/gallery-1661/g.svg`);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Lightbox", exact: true })
  ).toHaveCount(0);
  await expect(modal).toBeVisible();
  await modal.getByText("聊天记录", { exact: true }).click();
  await modal.locator(`img[src="${origin}/gallery-1661/h.svg"]`).click();
  await expectImage(page, "1 / 1", `${origin}/gallery-1661/h.svg`);
  await expect(
    page.getByRole("button", { name: "下一张", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上一张", exact: true })
  ).toHaveCount(0);
});

// Only HTTP storage and the server ACK are simulated. The composer, file reader,
// image measurement, SDK send queue, MediaMessageUploadTask and gallery are real.
async function installUploadBoundary(page: Page) {
  await page.evaluate(() => {
    const w = window as any;
    const sdk = w.WKSDK.shared();
    const msw = w.__msw;
    const stored = new Map<string, ArrayBuffer>();
    const uploads: Array<{ release: (status: number) => void }> = [];
    const packets: any[] = [];
    w.__galleryUpload = {
      uploads, packets,
      ack(index: number, reasonCode = 1) {
        const packet = packets[index];
        sdk.chatManager.sendingQueues.delete(packet.clientSeq);
        sdk.chatManager.notifyMessageStatusListeners({
          clientSeq: packet.clientSeq, messageID: `sent-${index}`,
          messageSeq: 100 + index, reasonCode,
        });
      },
    };
    sdk.connectManager.sendPacket = (packet: any) => {
      if (!packet.payload) return;
      packets.push(packet);
    };
    msw.worker.use(
      msw.http.get("*/file/upload/credentials", ({ request }: any) => {
        const name = new URL(request.url).searchParams.get("filename")!;
        return msw.HttpResponse.json({
          uploadUrl: `${location.origin}/gallery-upload/${encodeURIComponent(name)}`,
          downloadUrl: `${location.origin}/gallery-upload/${encodeURIComponent(name)}`,
          contentType: "image/png", key: name, expiredTime: Date.now() + 600000,
        });
      }),
      msw.http.put("*/gallery-upload/:name", async ({ request, params }: any) => {
        const body = await request.arrayBuffer();
        const status = await new Promise<number>((release) => {
          uploads.push({ release });
        });
        if (status === 200) stored.set(params.name, body);
        return new msw.HttpResponse(null, { status });
      }),
      msw.http.get("*/gallery-upload/:name", ({ params }: any) => {
        const body = stored.get(params.name);
        return new msw.HttpResponse(body || null, {
          status: body ? 200 : 404, headers: { "Content-Type": "image/png" },
        });
      }),
      msw.http.delete("*/message", () => msw.HttpResponse.json({})),
    );
  });
}

async function releaseUpload(page: Page, index: number, status = 200) {
  // Wait for the simulated storage response to be requested before releasing it.
  await page.waitForFunction((index) => !!(window as any).__galleryUpload.uploads[index], index);
  await page.evaluate(({ index, status }) => {
    (window as any).__galleryUpload.uploads[index].release(status);
  }, { index, status });
}

async function expectNoSentPacket(page: Page) {
  expect(await page.evaluate(() => (window as any).__galleryUpload.packets.length)).toBe(0);
}

async function acknowledge(page: Page, index: number, reasonCode = 1) {
  // Coordinate the fake server ACK; assertions below observe the resulting UI.
  await page.waitForFunction((index) => !!(window as any).__galleryUpload.packets[index], index);
  await page.evaluate(({ index, reasonCode }) => {
    (window as any).__galleryUpload.ack(index, reasonCode);
  }, { index, reasonCode });
}

for (const failure of ["none", "upload", "ack"] as const) {
  test(`@C1661 new photos remain visible through upload, ACK and retry (${failure})`, async ({ authedPage: page }) => {
    const origin = await openGalleryConversation(page);
    await installUploadBoundary(page);
    const count = failure === "none" ? 2 : 1;
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 200;
      canvas.getContext("2d")!.fillRect(0, 0, 320, 200);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const files = Array.from({ length: count }, (_, index) => ({
      name: `new-${index}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64"),
    }));
    await page.getByTestId("input-attachment-btn").locator("..").locator('input[type="file"]').setInputFiles(files);
    await expect(page.getByRole("img", { name: "new-0.png", exact: true })).toBeVisible();
    await page.locator('[contenteditable="true"]').press("Enter");
    const local = page.locator('[aria-busy="true"] > img[src^="data:image/"]');
    await expect(local).toBeVisible();
    await expect(local).toHaveJSProperty("naturalWidth", 320);
    await expect(local.locator("..")).toHaveAttribute("aria-busy", "true");
    await expectNoSentPacket(page);

    if (failure === "upload") {
      await releaseUpload(page, 0, 500);
      await expect(page.getByRole("button", { name: /上传失败，点击重试/ })).toBeVisible();
      await expect(local).toBeVisible();
      await expectNoSentPacket(page);
      await page.getByRole("button", { name: /上传失败，点击重试/ }).click();
    }
    await releaseUpload(page, failure === "upload" ? 1 : 0);
    const remote = page.locator(`img[src="${origin}/gallery-upload/new-0.png"]`);
    await expect(remote).toBeVisible();
    await expect(remote).toHaveJSProperty("naturalWidth", 320);
    await expect(remote.locator("..")).toHaveAttribute("aria-busy", "true");
    // Upload success alone must not put an unconfirmed message in the gallery.
    await page.locator(`[data-message-seq="1"] img[src="${origin}/gallery-1661/a.svg"]`).click();
    await expect(counter(page)).toHaveText("1 / 5");
    await page.keyboard.press("Escape");

    let finalPacket = 0;
    if (failure === "ack") {
      await acknowledge(page, 0, 2);
      await expect(page.getByRole("button", { name: /上传失败，点击重试/ })).toBeVisible();
      await expect(remote).toBeVisible();
      await page.getByRole("button", { name: /上传失败，点击重试/ }).click();
      await releaseUpload(page, 1);
      finalPacket = 1;
    }
    await acknowledge(page, finalPacket);
    await expect(remote.locator("..")).toHaveAttribute("role", "button");
    await remote.click();
    await expectImage(page, "6 / 6", `${origin}/gallery-upload/new-0.png`);
    await page.keyboard.press("Escape");

    if (count === 2) {
      await releaseUpload(page, 1);
      await acknowledge(page, 1);
      const second = page.locator(`img[src="${origin}/gallery-upload/new-1.png"]`);
      await expect(second).toBeVisible();
      await second.click();
      await expectImage(page, "7 / 7", `${origin}/gallery-upload/new-1.png`);
      await page.keyboard.press("ArrowLeft");
      await expectImage(page, "6 / 7", `${origin}/gallery-upload/new-0.png`);
      await page.keyboard.press("Escape");
    }
  });
}
