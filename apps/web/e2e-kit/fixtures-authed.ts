/* eslint-disable no-undef -- e2e code runs in Node, process is available */
/* eslint-disable react-hooks/rules-of-hooks -- `use` here is Playwright fixture callback */
import { test as base, expect, type Page } from "@playwright/test";

/**
 * octo-web authedPage fixture.
 *
 * 走 kit 的 `E2E_TARGET=local` 分支 + Lite mock 模式 (page.route in specs).
 * MSW 未装, 不 wait __MSW_READY__.
 *
 * SID 策略:
 *   octo-web 的 auth localStorage 键是 `${key}${sid}` 模式 (SessionScope.ts).
 *   sid 来自 URL `?sid=` → sessionStorage(`octo.session.sid`) → 已存的 token 回收 → 随机.
 *   e2e 里固定用 URL query `?sid=e2etest`, 让所有 key 落在 `${key}e2etest`.
 */

const E2E_SID = "e2etest";

const AUTH_KEYS_SUFFIXED = {
  token: "e2e-mock-token",
  uid: "e2e-user-1",
  name: "E2E Tester",
  app_id: "e2e-app",
  short_no: "10000",
  role: "0",
  is_work: "1",
  sex: "1",
  login_provider: "",
};

const SPACE_STORAGE_KEY = "currentSpaceId";
const LOCALE_STORAGE_KEY = "octo:locale";
const MOCK_SPACE_ID = "e2e-space-001";
const MOCK_LOCALE = "zh-CN";

type Fixtures = {
  authedPage: Page;
  /**
   * pagePlain — vanilla page: 不预置 auth, 不 goto, 不 wait __MSW_READY__.
   *
   * 用于 spec 自己控 storage 和 page.route 拦截 (如 bind 流程测试未登录跳转,
   * standalone-doc 测试深链冷启). 依赖 kit 已启动的 webServer (vite dev)
   * 但绕开 MSW 和 auth seed —— spec 内部 page.route 精确 mock 每种状态码.
   */
  pagePlain: Page;
};

export const test = base.extend<Fixtures>({
  authedPage: async ({ page }, use) => {
    const target = process.env.E2E_TARGET ?? "local";
    if (target !== "local" && target !== "test") {
      throw new Error(`[e2e-kit] E2E_TARGET 必须是 'local' 或 'test', 当前 = '${target}'`);
    }

    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => {
        (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(key, value);
      },
      { key: LOCALE_STORAGE_KEY, value: MOCK_LOCALE },
    );

    if (target === "local") {
      await page.addInitScript(
        ({
          sid,
          suffixed,
          spaceKey,
          spaceId,
        }: {
          sid: string;
          suffixed: Record<string, string>;
          spaceKey: string;
          spaceId: string;
        }) => {
          const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
          const ss = (globalThis as unknown as { sessionStorage: Storage }).sessionStorage;
          ss.setItem("octo.session.sid", sid);
          for (const [k, v] of Object.entries(suffixed)) {
            ls.setItem(`${k}${sid}`, v);
          }
          if (spaceKey && spaceId) ls.setItem(spaceKey, spaceId);
        },
        {
          sid: E2E_SID,
          suffixed: AUTH_KEYS_SUFFIXED,
          spaceKey: SPACE_STORAGE_KEY,
          spaceId: MOCK_SPACE_ID,
        },
      );

      await page.goto(`/?sid=${E2E_SID}`);

      // MSW 启动就绪信号 (仅在 VITE_E2E_MOCK=1 场景, index.tsx 会设 __MSW_READY__).
      // 有 SW 拦截才继续 goto 具体 case 页面; 避免竞态.
      await page.waitForFunction(
        () => (globalThis as unknown as { __MSW_READY__?: boolean }).__MSW_READY__ === true,
        undefined,
        { timeout: 15_000 }
      );
    } else {
      await page.goto("/");
    }

    await use(page);
  },

  pagePlain: async ({ page }, use) => {
    // 不预置任何 storage, 不 goto, 不 wait MSW. spec 拿到就是 vanilla page.
    // spec 需要禁 service worker 时可以自己 context.route('**/mockServiceWorker.js') 拦.
    await use(page);
  },
});

export {
  expect,
  E2E_SID,
  AUTH_KEYS_SUFFIXED,
  SPACE_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  MOCK_SPACE_ID,
  MOCK_LOCALE,
};
