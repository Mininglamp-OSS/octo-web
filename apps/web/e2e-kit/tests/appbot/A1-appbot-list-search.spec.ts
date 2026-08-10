/* eslint-disable no-undef -- e2e code runs in Node */
/* eslint-disable @typescript-eslint/no-explicit-any -- msw resolver types */
import { test, expect } from "../../fixtures-authed";
import type { Page } from "@playwright/test";
import {
  startRequestMonitor,
  sanityCheck,
  type SanityConfig,
} from "../../_lib/sanity";

type AppBotFixture = {
  id: string;
  uid: string;
  display_name: string;
  description: string;
  scope: "platform" | "space";
};

const sanityConfig: SanityConfig = {
  realHosts: ["127.0.0.1:9", "mock.e2e.local"],
  apiPrefixRe: /^\/(api|summary\/api)(\/|$)/,
  loginPathRe: /\/login(\?|$)/,
};

async function installAppbotHandlers(
  page: Page,
  bots: AppBotFixture[]
): Promise<void> {
  await page.evaluate(
    (fixture) => {
      type MSW = {
        worker: { use: (...handlers: unknown[]) => void };
        http: {
          get: (path: string, resolver: (info: any) => unknown) => unknown;
        };
        HttpResponse: { json: (body: unknown, init?: unknown) => unknown };
      };
      const msw = (window as unknown as { __msw?: MSW }).__msw;
      if (!msw) throw new Error("[A1] MSW worker 未就绪 (等 __MSW_READY__).");
      const { worker, http, HttpResponse } = msw;
      worker.use(
        http.get("*/api/v1/app_bot/available", () =>
          HttpResponse.json(fixture.bots)
        )
      );
    },
    { bots }
  );
}

async function openAppbotPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "应用", exact: true }).click();
  await expect(page.getByTestId("appbot-page-title")).toHaveText("应用");
}

const appBots: AppBotFixture[] = [
  {
    id: "app-docs",
    uid: "app-docs-bot",
    display_name: "文档助手",
    description: "搜索和整理文档",
    scope: "platform",
  },
  {
    id: "app-weekly",
    uid: "app-weekly-bot",
    display_name: "周报助手",
    description: "生成团队周报",
    scope: "space",
  },
];

test.describe("@A1 @p1 @appbot", () => {
  test("应用列表搜索", async ({ authedPage }) => {
    const ctx = startRequestMonitor(authedPage, sanityConfig);
    await installAppbotHandlers(authedPage, appBots);
    await openAppbotPage(authedPage);

    await expect(
      authedPage.getByText("平台应用", { exact: true })
    ).toBeVisible();
    await expect(authedPage.getByText(/空间应用/)).toBeVisible();
    await expect(
      authedPage.getByText("文档助手", { exact: true })
    ).toBeVisible();
    await expect(
      authedPage.getByText("周报助手", { exact: true })
    ).toBeVisible();

    await authedPage.getByPlaceholder("搜索", { exact: true }).fill("文档");
    await expect(
      authedPage.getByText("文档助手", { exact: true })
    ).toBeVisible();
    await expect(
      authedPage.getByText("周报助手", { exact: true })
    ).toBeHidden();

    await authedPage
      .getByPlaceholder("搜索", { exact: true })
      .fill("不存在的应用");
    await expect(
      authedPage.getByText("未找到匹配的应用", { exact: true })
    ).toBeVisible();
    await sanityCheck(authedPage, ctx);
  });

  test("空应用列表显示空状态", async ({ authedPage }) => {
    const ctx = startRequestMonitor(authedPage, sanityConfig);
    await installAppbotHandlers(authedPage, []);
    await openAppbotPage(authedPage);

    await expect(
      authedPage.getByText("暂无可用应用", { exact: true })
    ).toBeVisible();
    await expect(authedPage.getByText("文档助手", { exact: true })).toHaveCount(
      0
    );
    await sanityCheck(authedPage, ctx);
  });
});
