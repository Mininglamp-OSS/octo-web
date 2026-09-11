// @caseId C1661
// @spec apps/web/e2e-kit/case-specs/chat/C1661-image-gallery.md
import { test, expect } from "../../fixtures-authed";
import { installMockImRuntime } from "../../_kit/mock-im-runtime";
import type { Page } from "@playwright/test";

const GROUP_ID = "gallery-1661";
const GROUP_NAME = "Image gallery test";

async function openGalleryConversation(page: Page) {
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
        { type: 2, images: [image("c"), image("d")] },
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
  const slide = page
    .getByRole("region", { name: "Photo gallery", exact: true })
    .getByRole("group", { name: position.replace(" / ", " of "), exact: true });
  await expect(slide.locator("img")).toHaveAttribute("src", url);
  await expect(slide.locator("img")).toHaveJSProperty("complete", true);
}

test("@C1661 gallery navigates loaded image messages and downloads the visible attachment", async ({
  authedPage: page,
}, testInfo) => {
  const origin = await openGalleryConversation(page);
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
