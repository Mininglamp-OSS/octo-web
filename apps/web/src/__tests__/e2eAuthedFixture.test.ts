import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { fixtures } = vi.hoisted(() => ({ fixtures: {} as Record<string, unknown> }));
vi.mock("@playwright/test", async () => ({
  expect: (await import("vitest")).expect,
  test: { extend: (definitions: Record<string, unknown>) => Object.assign(fixtures, definitions) },
}));
import "../../e2e-kit/fixtures-authed";

function makePage() {
  return {
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

afterEach(() => vi.unstubAllEnvs());

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
});
