/* eslint-disable no-undef -- e2e code runs in Node */
import { expect, test } from "../../fixtures-authed";
import { installMockImRuntime, type MockSeed } from "../../_kit/mock-im-runtime";

const GROUP_ID = "e2e-member-removal";
const GROUP_NAME = "E2E 成员移出群";
const CURRENT_UID = "e2e-user-1";
const BOT_UID = "e2e-owned-bot";

function seed(includeBot: boolean): MockSeed {
  return {
    currentUid: CURRENT_UID,
    spaceId: "e2e-space-001",
    users: [
      { uid: CURRENT_UID, name: "E2E Tester", robot: 0 },
      { uid: BOT_UID, name: "E2E 我的 Bot", robot: 1 },
    ],
    groups: [{ group_no: GROUP_ID, name: GROUP_NAME }],
    conversations: [{ channelId: GROUP_ID, channelType: 2, unread: 0 }],
    messages: [],
    subscribers: [
      { uid: CURRENT_UID, name: "E2E Tester", channelId: GROUP_ID, channelType: 2, role: 0 },
      ...(includeBot ? [{ uid: BOT_UID, name: "E2E 我的 Bot", channelId: GROUP_ID,
        channelType: 2, role: 0, robot: 1 as const, orgData: { bot_owned_by_me: true } }] : []),
    ],
  };
}

async function openConversation(page: Parameters<typeof installMockImRuntime>[0], includeBot: boolean) {
  await installMockImRuntime(page, seed(includeBot));
  await page.reload();
  await page.getByRole("button", { name: "会话" }).click();
  await page.getByRole("button", { name: "最近", exact: true }).click();
  await page.getByText(GROUP_NAME, { exact: true }).click();
  await expect(page.locator('[contenteditable="true"]')).toBeVisible({ timeout: 15_000 });
}

test("@CH47 @p0 @chat 隐藏设置不查询成员，打开后每次最多核查 500 人", async ({ authedPage }) => {
  await openConversation(authedPage, false);
  await authedPage.evaluate(({ groupId, currentUid, botUid }) => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void };
      http: { get: (path: string, resolver: (args: any) => unknown) => unknown };
      HttpResponse: { json: (body: unknown, init?: { status?: number }) => unknown } };
    const msw = (window as any).__msw as Msw;
    (window as any).__memberRemovalReads = [] as number[];
    msw.worker.use(
      msw.http.get("*/groups/:groupNo/members/:uid", ({ params }) =>
        msw.HttpResponse.json(String(params.uid) === currentUid
          ? { exists: true, member: { uid: currentUid, name: "E2E Tester", role: 0, status: 1, robot: 0 } }
          : { exists: false })),
      msw.http.get("*/groups/:groupNo/members", ({ request, params }) => {
        if (String(params.groupNo) !== groupId) return msw.HttpResponse.json([]);
        const page = Number(new URL(request.url).searchParams.get("page")) || 1;
        (window as any).__memberRemovalReads.push(page);
        return msw.HttpResponse.json(Array.from({ length: 100 }, (_, index) => ({
          uid: page === 6 && index === 0 ? botUid : `member-${page}-${index}`,
          name: `成员 ${page}-${index}`,
          role: 0,
          status: 1,
          robot: page === 6 && index === 0 ? 1 : 0,
          bot_owned_by_me: page === 6 && index === 0,
        })));
      }),
    );
  }, { groupId: GROUP_ID, currentUid: CURRENT_UID, botUid: BOT_UID });

  await expect.poll(() => authedPage.evaluate(() => (window as any).__memberRemovalReads.length)).toBe(0);
  await authedPage.getByTestId("chat-channel-setting-entry").click();
  await expect(authedPage.getByRole("button", { name: "继续检查后 500 位成员" })).toBeVisible();
  expect(await authedPage.evaluate(() => (window as any).__memberRemovalReads)).toEqual([1, 2, 3, 4, 5]);
  await authedPage.getByRole("button", { name: "继续检查后 500 位成员" }).click();
  await expect(authedPage.getByTestId("group-member-remove-btn")).toBeVisible();
  expect(await authedPage.evaluate(() => (window as any).__memberRemovalReads)).toEqual([1, 2, 3, 4, 5, 6]);
});

test("@CH48 @p0 @chat 失败后重新核实只发 GET，不重复移出", async ({ authedPage }) => {
  await openConversation(authedPage, true);
  await authedPage.evaluate(({ groupId, currentUid, botUid }) => {
    type Msw = { worker: { use: (...handlers: unknown[]) => void };
      http: {
        get: (path: string, resolver: (args: any) => unknown) => unknown;
        delete: (path: string, resolver: (args: any) => unknown) => unknown;
      };
      HttpResponse: { json: (body: unknown, init?: { status?: number }) => unknown } };
    const msw = (window as any).__msw as Msw;
    (window as any).__memberRemovalDeleteCount = 0;
    (window as any).__memberRemovalBotReads = 0;
    const rows = [
      { uid: currentUid, name: "E2E Tester", role: 0, status: 1, robot: 0, bot_owned_by_me: false },
      { uid: botUid, name: "E2E 我的 Bot", role: 0, status: 1, robot: 1, bot_owned_by_me: true },
    ];
    msw.worker.use(
      msw.http.delete("*/groups/:groupNo/members", () => {
        (window as any).__memberRemovalDeleteCount += 1;
        return msw.HttpResponse.json({ msg: "temporary failure" }, { status: 500 });
      }),
      msw.http.get("*/groups/:groupNo/members/:uid", ({ params }) => {
        const uid = String(params.uid);
        if (uid === botUid) {
          (window as any).__memberRemovalBotReads += 1;
          if ((window as any).__memberRemovalBotReads <= 2) {
            return msw.HttpResponse.json({ msg: "temporary failure" }, { status: 503 });
          }
          return msw.HttpResponse.json({ exists: false });
        }
        const row = rows.find(item => item.uid === uid);
        return msw.HttpResponse.json(row ? { exists: true, member: row } : { exists: false });
      }),
      msw.http.get("*/groups/:groupNo/members", ({ params }) =>
        msw.HttpResponse.json(String(params.groupNo) === groupId ? rows : [])),
    );
  }, { groupId: GROUP_ID, currentUid: CURRENT_UID, botUid: BOT_UID });

  await authedPage.getByTestId("chat-channel-setting-entry").click();
  await authedPage.getByTestId("group-member-remove-btn").click();
  await authedPage.getByRole("checkbox", { name: "E2E 我的 Bot" }).click();
  await authedPage.getByRole("button", { name: "完成", exact: true }).click();
  const confirm = authedPage.locator(".wk-modal-content").filter({ hasText: "E2E 我的 Bot" });
  await confirm.getByRole("button", { name: "移除", exact: true }).click();
  await expect(authedPage.getByRole("button", { name: "重新核实结果" })).toBeVisible();
  expect(await authedPage.evaluate(() => (window as any).__memberRemovalDeleteCount)).toBe(1);
  await authedPage.getByRole("button", { name: "重新核实结果" }).click();
  await expect(authedPage.getByText("移出成员", { exact: true })).toHaveCount(0);
  expect(await authedPage.evaluate(() => (window as any).__memberRemovalDeleteCount)).toBe(1);
});
