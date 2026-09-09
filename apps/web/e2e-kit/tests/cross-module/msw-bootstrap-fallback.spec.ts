/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";

test.use({ serviceWorkers: "block" });

const categoriesRoute = "**/api/v1/spaces/*/categories*";
const categoriesUrl = "/api/v1/spaces/e2e-space-001/categories";

test.beforeEach(async ({ pagePlain }) => {
  // Exercise the real pagePlain fallback routes without booting the SPA or
  // stopping its worker (which could leak unrelated requests to the dead proxy).
  await pagePlain.route("**/msw-bootstrap-fallback.html", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>MSW bootstrap fallback boundary</title>",
    })
  );
  await pagePlain.goto("/msw-bootstrap-fallback.html");
});

test("@p1 @cross-module @infra startup fallback fulfills a request that began before MSW readiness", async ({
  pagePlain,
}) => {
  const fellThrough: string[] = [];
  // Context routes run after page routes, including the production fixture's
  // fallback. A sentinel makes an incorrect fallthrough fail without proxy noise.
  await pagePlain.context().route(categoriesRoute, (route) => {
    fellThrough.push(route.request().url());
    return route.fulfill({
      status: 418,
      contentType: "text/plain",
      body: "fell through",
    });
  });

  await pagePlain.route(categoriesRoute, async (route) => {
    // The fixture's request event has already recorded Date.now(). Wait for a
    // genuinely later browser clock tick, then publish real (not future) readiness
    // before letting the fixture classify this still-pending request.
    const requestObservedAt = Date.now();
    await pagePlain.waitForFunction(
      (observedAt) => Date.now() > observedAt,
      requestObservedAt
    );
    await pagePlain.evaluate(() => {
      const state = globalThis as unknown as {
        __MSW_READY__?: boolean;
        __MSW_READY_AT__?: number;
      };
      state.__MSW_READY_AT__ = Date.now();
      state.__MSW_READY__ = true;
    });
    await route.fallback();
  });

  const response = await pagePlain.evaluate(async (url) => {
    const result = await fetch(url);
    return { status: result.status, body: await result.text() };
  }, categoriesUrl);

  expect(response).toEqual({ status: 200, body: "[]" });
  expect(fellThrough).toEqual([]);
});

test("@p1 @cross-module @infra startup fallback leaves requests begun after MSW readiness unhandled", async ({
  pagePlain,
}) => {
  const fellThrough: string[] = [];
  await pagePlain.context().route(categoriesRoute, (route) => {
    fellThrough.push(route.request().url());
    return route.fulfill({
      status: 418,
      contentType: "text/plain",
      body: "fell through",
    });
  });

  const readyAt = await pagePlain.evaluate(() => {
    const state = globalThis as unknown as {
      __MSW_READY__?: boolean;
      __MSW_READY_AT__?: number;
    };
    state.__MSW_READY_AT__ = Date.now();
    state.__MSW_READY__ = true;
    return state.__MSW_READY_AT__;
  });
  // Establish strict ordering against the Node clock used by the fixture's
  // request listener, without a fixed sleep or modifying either clock.
  await expect.poll(() => Date.now()).toBeGreaterThan(readyAt);

  const response = await pagePlain.evaluate(async (url) => {
    const result = await fetch(url);
    return { status: result.status, body: await result.text() };
  }, categoriesUrl);

  expect(response).toEqual({ status: 418, body: "fell through" });
  expect(fellThrough).toEqual([new URL(categoriesUrl, pagePlain.url()).href]);
});
