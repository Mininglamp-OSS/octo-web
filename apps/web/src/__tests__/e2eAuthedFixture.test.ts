import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fixtures } = vi.hoisted(() => ({ fixtures: {} as Record<string, unknown> }));
vi.mock("@playwright/test", async () => ({
  expect: (await import("vitest")).expect,
  test: { extend: (definitions: Record<string, unknown>) => Object.assign(fixtures, definitions) },
}));
import "../../e2e-kit/fixtures-authed";

function makePage() {
  const context = Object.assign(new EventEmitter(), { route: vi.fn().mockResolvedValue(undefined) });
  return {
    context: () => context,
    addInitScript: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
  };
}

type PageFixture = (
  args: { page: ReturnType<typeof makePage>; authedLocale: "zh-CN" | "en-US" },
  use: (page: ReturnType<typeof makePage>) => Promise<void>,
) => Promise<void>;
type GuardFixture = (
  args: { context: EventEmitter; mockApiGuard: boolean },
  use: () => Promise<void>,
) => Promise<void>;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authed E2E fixture", () => {
  it("preserves Chinese and disabled strict guard defaults", () => {
    expect(fixtures.authedLocale).toEqual(["zh-CN", { option: true }]);
    expect(fixtures.mockApiGuard).toEqual([false, { option: true }]);
  });

  it.each(["zh-CN", "en-US"] as const)("seeds %s before the only initial navigation", async authedLocale => {
    vi.stubEnv("E2E_TARGET", "local");
    const page = makePage();
    const use = vi.fn().mockResolvedValue(undefined);
    await (fixtures.authedPage as PageFixture)({ page, authedLocale }, use);
    expect(page.addInitScript.mock.calls[0][1]).toEqual({ key: "octo:locale", value: authedLocale });
    expect(page.addInitScript.mock.invocationCallOrder[0]).toBeLessThan(page.goto.mock.invocationCallOrder[0]);
    expect(page.goto).toHaveBeenCalledExactlyOnceWith("/?sid=e2etest");
    expect(use).toHaveBeenCalledWith(page);
  });

  it("installs the guard automatically before fixture use and catches setup-time worker traffic", async () => {
    const [guard, options] = fixtures._mockApiGuard as [GuardFixture, { auto: boolean }];
    expect(options.auto).toBe(true);
    const context = new EventEmitter();
    await expect(guard({ context, mockApiGuard: true }, async () => {
      expect(context.listenerCount("request")).toBe(1);
      context.emit("request", {
        url: () => "http://localhost:5173/api/v1/spaces/x/categories",
        method: () => "GET",
        serviceWorker: () => ({}),
      });
    })).rejects.toThrow("Mock API requests must not escape or fail");
    expect(context.eventNames()).toEqual([]);
  });

  it("does not install strict checks for existing intentional-error scenarios", async () => {
    const [guard] = fixtures._mockApiGuard as [GuardFixture];
    const context = new EventEmitter();
    await guard({ context, mockApiGuard: false }, async () => {
      expect(context.eventNames()).toEqual([]);
    });
  });

  it("cleans up observers when test setup fails", async () => {
    const [guard] = fixtures._mockApiGuard as [GuardFixture];
    const context = new EventEmitter();
    await expect(guard({ context, mockApiGuard: true }, async () => {
      throw new Error("setup failed");
    })).rejects.toThrow("setup failed");
    expect(context.eventNames()).toEqual([]);
  });

  it.each([
    ["**/api/v1/spaces/*/categories*", "/api/v1/spaces/e2e-space-001/categories"],
    ["**/summary/api/v1/summaries/attention*", "/summary/api/v1/summaries/attention"],
  ])("handles pre-ready worker requests without masking post-ready misses: %s", async (pattern, path) => {
    vi.stubEnv("E2E_TARGET", "local");
    const page = makePage();
    await (fixtures.authedPage as PageFixture)({ page, authedLocale: "zh-CN" }, async () => {});
    const handle = page.context().route.mock.calls.find(([registered]) => registered === pattern)![1];
    const clock = vi.spyOn(Date, "now");
    const makeRoute = () => ({
      request: () => request,
      fulfill: vi.fn().mockResolvedValue(undefined),
      fallback: vi.fn().mockResolvedValue(undefined),
    });
    let request: { method: () => string; url: () => string; headers: () => Record<string, string>; serviceWorker: () => object | null };
    const run = async (startedAt: number, readiness: { ready: boolean; readyAt?: number }, worker = true, method = "GET") => {
      request = { method: () => method, url: () => `http://localhost:5173${path}`, headers: () => ({}), serviceWorker: () => worker ? {} : null };
      clock.mockReturnValue(startedAt);
      // Only context receives the worker-owned event; page.on must not be needed.
      page.context().emit("request", request);
      page.evaluate.mockResolvedValue(readiness);
      const route = makeRoute();
      await handle(route);
      return route;
    };
    const duringNavigation = await run(100, { ready: false });
    expect(duringNavigation.fulfill).toHaveBeenCalledOnce();
    const readinessChanged = await run(100, { ready: true, readyAt: 101 });
    expect(readinessChanged.fulfill).toHaveBeenCalledOnce();
    const alreadyReady = await run(102, { ready: true, readyAt: 101 });
    expect(alreadyReady.fulfill).not.toHaveBeenCalled();
    expect(alreadyReady.fallback).toHaveBeenCalledOnce();
    const pageOwned = await run(100, { ready: false }, false);
    expect(pageOwned.fulfill).not.toHaveBeenCalled();
    expect(pageOwned.fallback).toHaveBeenCalledOnce();
    const mutation = await run(100, { ready: false }, true, "POST");
    expect(mutation.fulfill).not.toHaveBeenCalled();
    expect(mutation.fallback).toHaveBeenCalledOnce();
    // Missing timing data after readiness must fail closed as well.
    request = { method: () => "GET", url: () => `http://localhost:5173${path}`, headers: () => ({}), serviceWorker: () => ({}) };
    page.evaluate.mockResolvedValue({ ready: true, readyAt: 101 });
    const unobserved = makeRoute();
    await handle(unobserved);
    expect(unobserved.fulfill).not.toHaveBeenCalled();
    expect(unobserved.fallback).toHaveBeenCalledOnce();
  });

  it.each([false, true])("strict guard only accepts a fulfilled pre-ready worker request (ready=%s)", async (ready) => {
    vi.stubEnv("E2E_TARGET", "local");
    const page = makePage();
    const [guard] = fixtures._mockApiGuard as [GuardFixture];
    const outcome = guard({ context: page.context(), mockApiGuard: true }, async () => {
      await (fixtures.authedPage as PageFixture)({ page, authedLocale: "zh-CN" }, async () => {});
      const handle = page.context().route.mock.calls.find(([pattern]) => pattern === "**/api/v1/spaces/*/categories*")![1];
      const request = {
        method: () => "GET", url: () => "http://localhost:5173/api/v1/spaces/e2e-space-001/categories",
        headers: () => ({}), serviceWorker: () => ({}),
      };
      vi.spyOn(Date, "now").mockReturnValue(102);
      page.context().emit("request", request);
      page.evaluate.mockResolvedValue({ ready, readyAt: 101 });
      const route = { request: () => request, fulfill: vi.fn().mockResolvedValue(undefined), fallback: vi.fn().mockResolvedValue(undefined) };
      await handle(route);
      expect(route.fulfill).toHaveBeenCalledTimes(ready ? 0 : 1);
    });
    if (ready) await expect(outcome).rejects.toThrow("Mock API requests must not escape or fail");
    else await expect(outcome).resolves.toBeUndefined();
  });
});
