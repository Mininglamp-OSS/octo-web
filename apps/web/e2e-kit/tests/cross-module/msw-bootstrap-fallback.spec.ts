/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";

test("@p1 @cross-module @infra startup fallback fulfills a request that began before MSW readiness", async ({
  pagePlain,
}) => {
  await pagePlain.goto("/");
  await pagePlain.waitForFunction(
    () =>
      (globalThis as unknown as { __MSW_READY__?: boolean }).__MSW_READY__ ===
      true
  );
  await pagePlain.evaluate(() => {
    const state = globalThis as unknown as {
      __MSW_READY__?: boolean;
      __MSW_READY_AT__?: number;
      __msw?: { worker: { stop: () => void } };
    };
    state.__msw?.worker.stop();
    state.__MSW_READY__ = false;
    delete state.__MSW_READY_AT__;
  });

  await pagePlain.route("**/api/v1/spaces/*/categories*", async (route) => {
    // This route was registered after the fixture route, so it runs after the
    // request event but before the fixture decides whether to fulfill. Flip
    // readiness here to reproduce the bootstrap race deterministically.
    await pagePlain.evaluate(() => {
      const state = globalThis as unknown as {
        __MSW_READY__?: boolean;
        __MSW_READY_AT__?: number;
      };
      state.__MSW_READY_AT__ = Date.now() + 1_000;
      state.__MSW_READY__ = true;
    });
    await route.fallback();
  });

  const response = await pagePlain.evaluate(async () => {
    const result = await fetch("/api/v1/spaces/e2e-space-001/categories");
    return { status: result.status, body: await result.json() };
  });

  expect(response).toEqual({ status: 200, body: [] });
});
