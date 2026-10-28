/* eslint-disable no-undef -- e2e code runs in Node */
import { test, expect } from "../../fixtures-authed";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

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

test.describe("worker-owned bootstrap requests", () => {
  test.use({ serviceWorkers: "allow" });

  for (const ready of [false, true]) {
    test.describe(`MSW ready=${ready}`, () => {
      // The allowed boot fallback must also pass the fixture's strict monitor.
      // The ready case intentionally reaches the isolated origin's 418 sentinel.
      test.use({ mockApiGuard: !ready });
      test(`@p1 @cross-module @infra worker-owned fallback respects MSW readiness (${ready})`, async ({ pagePlain: page }) => {
      // A tiny isolated origin makes the ownership boundary deterministic. Its
      // forwarding worker reproduces MSW's network fallback when the originating
      // document has lost its client; an unhandled request returns 418 locally
      // rather than touching the dead Vite backend or weakening its CI guard.
      const unhandled: string[] = [];
      const server = createServer((request, response) => {
        if (request.url === "/bootstrap-worker.js") {
          response.writeHead(200, { "content-type": "application/javascript" });
          response.end(`
            self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
            self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
            self.addEventListener('fetch', event => {
              if (new URL(event.request.url).pathname.endsWith('/categories')) {
                event.respondWith(fetch(event.request));
              }
            });
          `);
        } else if (request.url === categoriesUrl) {
          unhandled.push(request.url);
          response.writeHead(418, { "content-type": "text/plain" });
          response.end("fell through");
        } else {
          response.writeHead(200, { "content-type": "text/html" });
          response.end("<!doctype html><title>Worker bootstrap boundary</title>");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const workerRequests: string[] = [];
      page.context().on("request", (request) => {
        if (request.serviceWorker() && new URL(request.url()).pathname === categoriesUrl) {
          workerRequests.push(request.url());
        }
      });
      try {
        await page.goto(origin);
        await page.evaluate(async () => {
          await navigator.serviceWorker.register("/bootstrap-worker.js");
          await navigator.serviceWorker.ready;
        });
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        const readyAt = await page.evaluate((isReady) => {
          const state = globalThis as unknown as { __MSW_READY__?: boolean; __MSW_READY_AT__?: number };
          state.__MSW_READY__ = isReady;
          state.__MSW_READY_AT__ = Date.now();
          return state.__MSW_READY_AT__;
        }, ready);
        await expect.poll(() => Date.now()).toBeGreaterThan(readyAt);
        const result = await page.evaluate(async (path) => {
          const response = await fetch(path);
          return { status: response.status, body: await response.text() };
        }, categoriesUrl);
        expect(workerRequests).toEqual([`${origin}${categoriesUrl}`]);
        expect(result).toEqual(ready ? { status: 418, body: "fell through" } : { status: 200, body: "[]" });
        expect(unhandled).toEqual(ready ? [categoriesUrl] : []);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
      });
    });
  }
});
