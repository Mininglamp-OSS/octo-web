import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("skillApi public exports", () => {
  it("uses the real client by default", async () => {
    vi.resetModules();

    const api = await import("./skillApi");

    expect(api.getCategories).toBe((await import("./skillApiReal")).getCategories);
  });

  it("uses the mock client only when VITE_USE_MOCK=true", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_USE_MOCK", "true");

    const api = await import("./skillApi");

    await expect(api.getCategories()).resolves.toHaveLength(16);
  });
});
