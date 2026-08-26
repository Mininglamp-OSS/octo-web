/**
 * mock-im-runtime — 门面。
 *
 * test 侧只 import 这里的两个东西:
 *   - `installMockImRuntime(page, seed)` — 在 Playwright test 里安装,序列化 seed
 *     后传到浏览器,浏览器侧调 baseline main.tsx 挂到 window 上的 install 钩子。
 *   - `MockSeed` 类型
 *
 * baseline main.tsx 在 DEV + VITE_E2E_MOCK_IM=1 时,
 * import fakeProvider 并挂钩子到 `window.__installMockImRuntime__` 上。
 */
/* eslint-disable no-undef -- e2e code */

import type { Page } from "@playwright/test";
import type { MockSeed } from "./seed-types";

export type { MockSeed } from "./seed-types";
export type {
  MockUserSeed,
  MockGroupSeed,
  MockConversationSeed,
  MockMessageSeed,
  MockSubscriberSeed,
} from "./seed-types";

export async function installMockImRuntime(page: Page, seed: MockSeed): Promise<void> {
  // Also register the seed for the next document. This is needed by preview/CI
  // runs where the app mounts before a case-specific seed is installed; the
  // current-document evaluate below keeps the helper convenient for cases that
  // do not reload.
  await page.addInitScript((seedJson: MockSeed) => {
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const install = (globalThis as { __installMockImRuntime__?: (s: MockSeed) => void })
        .__installMockImRuntime__;
      if (typeof install === "function") {
        install(seedJson);
        clearInterval(timer);
      } else if (tries > 200) {
        clearInterval(timer);
      }
    }, 100);
  }, seed);
  await page.waitForFunction(
    () =>
      typeof (globalThis as { __installMockImRuntime__?: unknown }).__installMockImRuntime__ ===
      "function",
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate((seedJson: MockSeed) => {
    const install = (globalThis as { __installMockImRuntime__?: (s: MockSeed) => void })
      .__installMockImRuntime__;
    if (!install) throw new Error("[mock-im-runtime] __installMockImRuntime__ 未挂载");
    install(seedJson);
  }, seed);
}
