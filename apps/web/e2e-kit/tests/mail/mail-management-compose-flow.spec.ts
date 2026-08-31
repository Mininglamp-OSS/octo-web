/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";

const MAILBOX_CONTEXT = "agent-mailbox-e2e";

async function enableMail(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("__e2e_scenario", "mail");
  });
  await page.reload();
}

async function installMailWorkspaceHandlers(page: Page) {
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __MSW_READY__?: boolean }).__MSW_READY__)
  );
  await page.evaluate(
    ({ mailboxContext }) => {
      type MSW = {
        worker: { use: (...handlers: unknown[]) => void };
        http: {
          get: (path: string, resolver: (info: any) => unknown) => unknown;
        };
        HttpResponse: { json: (body: unknown) => unknown };
      };
      const msw = (window as unknown as { __msw?: MSW }).__msw;
      if (!msw) throw new Error("[mail management] MSW worker 未就绪");
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
            maxMailboxes: 5,
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
                total: 0,
                unread: 0,
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
        http.get("*/mail-api/webapi/v0/messages", () =>
          HttpResponse.json({ messages: [], total: 0, offset: 0, limit: 30 })
        )
      );
    },
    { mailboxContext: MAILBOX_CONTEXT }
  );
}

async function openMail(page: Page) {
  await page.getByRole("button", { name: "邮件", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Agent Mail" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱/ })).toBeVisible();
}

test.describe("@MM1 @p1 @mail @mail-management", () => {
  test("打开 Agent mailbox 管理页", async ({ authedPage }) => {
    await enableMail(authedPage);
    await installMailWorkspaceHandlers(authedPage);
    await openMail(authedPage);
    await authedPage.getByText("管理 Agent 邮箱", { exact: true }).click();
    await expect(
      authedPage.getByRole("heading", { name: "Agent 邮箱管理" })
    ).toBeVisible();
    await expect(
      authedPage.getByText("e2e-agent@example.com", { exact: true })
    ).toBeVisible();
    await expect(
      authedPage.getByText("新建 Agent 邮箱", { exact: true })
    ).toBeVisible();
  });
});

test.describe("@MM2 @p1 @mail @mail-compose", () => {
  test("打开新邮件编辑器", async ({ authedPage }) => {
    await enableMail(authedPage);
    await installMailWorkspaceHandlers(authedPage);
    await openMail(authedPage);
    await authedPage
      .getByRole("button", { name: "写邮件", exact: true })
      .click();
    const composer = authedPage.getByRole("dialog");
    await expect(composer).toBeVisible();
    await expect(
      composer.getByRole("heading", { name: "新邮件" })
    ).toBeVisible();
    await expect(
      composer.getByPlaceholder("多个地址用逗号分隔", { exact: true })
    ).toBeVisible();
    await expect(
      composer.getByPlaceholder("邮件主题", { exact: true })
    ).toBeVisible();
    await expect(
      composer.getByPlaceholder("输入邮件内容…", { exact: true })
    ).toBeVisible();
  });
});
