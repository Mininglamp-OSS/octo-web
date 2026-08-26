/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import {
  installMockImRuntime,
  type MockSeed,
} from "../../_kit/mock-im-runtime";

const CONTACT_UID = "e2e-user-2";
const CONTACT_NAME = "E2E 联系人";
const OTHER_NAME = "其他成员";

function contactsSeed(overrides: Partial<MockSeed> = {}): MockSeed {
  return {
    currentUid: "e2e-user-1",
    spaceId: "e2e-space-001",
    users: [
      { uid: "e2e-user-1", name: "E2E Tester", short_no: "e2e-1000" },
      { uid: CONTACT_UID, name: CONTACT_NAME, short_no: "e2e-2001" },
      { uid: "e2e-user-3", name: OTHER_NAME, short_no: "e2e-3001" },
    ],
    groups: [],
    conversations: [],
    messages: [],
    subscribers: [],
    ...overrides,
  };
}

async function installContactsHandlers(
  page: Parameters<typeof installMockImRuntime>[0]
) {
  await page.evaluate(
    ({ contactUid, contactName, otherName }) => {
      type MSW = {
        worker: { use: (...handlers: unknown[]) => void };
        http: { get: (path: string, resolver: () => unknown) => unknown };
        HttpResponse: { json: (body: unknown) => unknown };
      };
      const msw = (window as unknown as { __msw?: MSW }).__msw;
      if (!msw) throw new Error("[contacts] MSW worker 未就绪");
      const { worker, http, HttpResponse } = msw;
      worker.use(
        http.get("*/space/:spaceId/members", () =>
          HttpResponse.json([
            { uid: "e2e-user-1", name: "E2E Tester", robot: 0 },
            { uid: contactUid, name: contactName, robot: 0 },
            { uid: "e2e-user-3", name: otherName, robot: 0 },
          ])
        ),
        http.get("*/robot/my_bots", () => HttpResponse.json([])),
        http.get("*/robot/space_bots", () => HttpResponse.json([])),
        http.get("*/group/my", () => HttpResponse.json([])),
        http.get("*/users/:uid", () =>
          HttpResponse.json({
            uid: contactUid,
            name: contactName,
            short_no: "e2e-2001",
            remark: "",
            realname_verified: 0,
            real_name: "",
            extra: {},
          })
        )
      );
    },
    {
      contactUid: CONTACT_UID,
      contactName: CONTACT_NAME,
      otherName: OTHER_NAME,
    }
  );
}

async function openContacts(page: Parameters<typeof installMockImRuntime>[0]) {
  await page.getByRole("button", { name: "通讯录", exact: true }).click();
  await expect(page.getByText("全部联系人", { exact: true })).toBeVisible();
}

async function openAllContacts(
  page: Parameters<typeof installMockImRuntime>[0]
) {
  await openContacts(page);
  const header = page
    .locator(".wk-contacts-accordion-header")
    .filter({ hasText: "全部联系人" });
  await expect(header).toContainText("(2)");
}

test.describe("@CT1 @p0 @contacts @contacts-list", () => {
  test("进入通讯录并显示联系人列表", async ({ authedPage }) => {
    await installMockImRuntime(authedPage, contactsSeed());
    await installContactsHandlers(authedPage);
    await openAllContacts(authedPage);
  });
});

test.describe("@CT2 @p1 @contacts @contacts-search", () => {
  test("搜索联系人", async ({ authedPage }) => {
    await installMockImRuntime(authedPage, contactsSeed());
    await installContactsHandlers(authedPage);
    await openContacts(authedPage);

    await authedPage
      .getByPlaceholder("搜索通讯录", { exact: true })
      .fill("E2E 联系");
    await expect(authedPage.getByText("联系人", { exact: true })).toBeVisible();
    await expect(
      authedPage.getByText(CONTACT_NAME, { exact: true })
    ).toBeVisible();
    await expect(authedPage.getByText(OTHER_NAME, { exact: true })).toHaveCount(
      0
    );
  });
});

test.describe("@CT3 @p1 @contacts @contacts-profile", () => {
  test("打开联系人资料详情", async ({ authedPage }) => {
    await installMockImRuntime(authedPage, contactsSeed());
    await installContactsHandlers(authedPage);
    await openContacts(authedPage);
    await authedPage
      .getByPlaceholder("搜索通讯录", { exact: true })
      .fill(CONTACT_NAME);
    await authedPage.getByText(CONTACT_NAME, { exact: true }).click();
    await expect(authedPage.getByText(/Octo号/)).toBeVisible();
    await expect(authedPage.getByText(/e2e-2001/)).toBeVisible();
  });
});
