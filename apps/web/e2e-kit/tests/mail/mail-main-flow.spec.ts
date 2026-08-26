/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";

const MAILBOX_CONTEXT = "agent-mailbox-e2e";
const MESSAGE_ID = "mail-e2e-1";

type Message = {
  id: string;
  mailbox: string;
  subject: string;
  from: string;
  to: string[];
  preview: string;
  receivedAt: string;
  size: number;
  keywords: string[];
  unread: boolean;
};

async function enableMail(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "mail");
  });
  await page.reload();
}

const BASE_MESSAGE: Message = {
  id: MESSAGE_ID,
  mailbox: "INBOX",
  subject: "E2E Mail 主题",
  from: "sender@example.com",
  to: ["e2e-agent@example.com"],
  preview: "这是 E2E 邮件预览",
  receivedAt: "2026-08-20T08:00:00.000Z",
  size: 128,
  keywords: [],
  unread: true,
};

async function installMailHandlers(
  page: Page,
  messages: Message[],
  searchMessages = messages
) {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __MSW_READY__?: boolean }).__MSW_READY__)
  );
  await page.evaluate(
    ({ mailboxContext, messages: seededMessages, searchResult }) => {
      type MSW = {
        worker: { use: (...handlers: unknown[]) => void };
        http: {
          get: (path: string, resolver: (info: any) => unknown) => unknown;
        };
        HttpResponse: {
          json: (body: unknown) => unknown;
        };
      };
      const msw = (window as unknown as { __msw?: MSW }).__msw;
      if (!msw) throw new Error("[mail] MSW worker 未就绪");
      const { worker, http, HttpResponse } = msw;
      worker.use(
        http.get("*/mail-api/webapi/v0/agent-mailboxes", () =>
          HttpResponse.json({
            mailboxes: [
              {
                id: mailboxContext,
                address: "e2e-agent@example.com",
                agentName: "E2E Agent",
                connectState: "connected",
                outboundMode: "manual_confirmation",
              },
            ],
            registeredCount: 1,
            maxMailboxes: 10,
            addressDomain: "example.com",
          })
        ),
        http.get("*/mail-api/webapi/v0/mailboxes", () =>
          HttpResponse.json({
            mailboxes: [
              {
                id: "inbox",
                name: "INBOX",
                role: "inbox",
                total: seededMessages.length,
                unread: seededMessages.length,
              },
            ],
          })
        ),
        http.get("*/mail-api/webapi/v0/identity", () =>
          HttpResponse.json({ address: "e2e-agent@example.com" })
        ),
        http.get("*/mail-api/webapi/v0/state", () =>
          HttpResponse.json({ state: "connected" })
        ),
        http.get("*/mail-api/webapi/v0/messages", (info) => {
          const url = new URL(info.request.url);
          const search = url.searchParams.get("search") || "";
          const result = search ? searchResult : seededMessages;
          return HttpResponse.json({
            messages: result,
            total: result.length,
            offset: 0,
            limit: 30,
          });
        }),
        http.get("*/mail-api/webapi/v0/messages/:id", () =>
          HttpResponse.json({
            ...seededMessages[0],
            bodyText: "这是 E2E 邮件正文",
          })
        ),
        http.get("*/v1/mail-gateway/webapi/v0/messages/:id", () =>
          HttpResponse.json({
            ...seededMessages[0],
            bodyText: "这是 E2E 邮件正文",
          })
        )
      );
    },
    { mailboxContext: MAILBOX_CONTEXT, messages, searchResult: searchMessages }
  );
}

async function openMail(page: Page) {
  await page.getByRole("button", { name: "邮件", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Agent Mail" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱/ })).toBeVisible();
}

test.describe("@ML1 @p0 @mail @mail-inbox", () => {
  test("进入 Mail 并显示空收件箱", async ({ authedPage }) => {
    await enableMail(authedPage);
    await installMailHandlers(authedPage, []);
    await openMail(authedPage);
    await expect(
      authedPage.getByText("这里还没有邮件", { exact: true })
    ).toBeVisible();
    await expect(
      authedPage.getByText("当前目录为空，可以刷新或写一封新邮件。", {
        exact: true,
      })
    ).toBeVisible();
  });
});

test.describe("@ML2 @p1 @mail @mail-reader", () => {
  test("打开 Mail 邮件详情", async ({ authedPage }) => {
    await enableMail(authedPage);
    await installMailHandlers(authedPage, [BASE_MESSAGE]);
    await openMail(authedPage);
    await expect(
      authedPage.getByRole("button", { name: /E2E Mail 主题/ })
    ).toBeVisible();
    await expect(
      authedPage.getByText("这是 E2E 邮件正文", { exact: true })
    ).toBeVisible();
  });
});

test.describe("@ML3 @p1 @mail @mail-search", () => {
  test("搜索 Mail 邮件", async ({ authedPage }) => {
    await enableMail(authedPage);
    const searchResult = { ...BASE_MESSAGE, subject: "E2E 搜索结果" };
    await installMailHandlers(authedPage, [BASE_MESSAGE], [searchResult]);
    await openMail(authedPage);
    const search = authedPage.getByPlaceholder("搜索邮件", { exact: true });
    await search.fill("E2E 搜索");
    await expect(search).toHaveValue("E2E 搜索");
    await expect(
      authedPage.getByText("E2E 搜索结果", { exact: true })
    ).toBeVisible();
  });
});
