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
    const mock = await import("./skillApiMock");
    const real = await import("./skillApiReal");
    expect(api.getSkillDraft).toBe(mock.getSkillDraft);
    expect(api.getPublishedAudience).toBe(mock.getPublishedAudience);
    expect(api.changePublishedAudience).toBe(mock.changePublishedAudience);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const mine = await api.getMySkills({});
    expect(mine.items.length).toBeGreaterThan(0);
    await expect(api.getSkillDraft(mine.items[0].id)).resolves.toMatchObject({ id: mine.items[0].id });
    await expect(api.getPublishedAudience(mine.items[0].id)).rejects.toThrow();
    await expect(api.changePublishedAudience(mine.items[0].id, "mock-release", "space")).rejects.toThrow();
    expect(api.getSkillDraft).not.toBe(real.getSkillDraft);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
