import { describe, expect, it, vi } from "vitest";
import { clearAuthSessionCookies, type SessionLike } from "../clearAuthSession";

describe("clearAuthSessionCookies", () => {
  it("clears deduplicated cookies and auth cache", async () => {
    const removed: string[] = [];
    const session: SessionLike = {
      cookies: {
        get: async () => [
          { name: "sid", domain: "idp.example.com", path: "/", secure: true },
          { name: "sid", domain: "idp.example.com", path: "/", secure: true },
          { name: "scoped", domain: ".idp.example.com", path: "/auth", secure: true },
        ],
      remove: async (url, name) => {
        removed.push(`${url}:${name}`);
      },
      },
      clearAuthCache: async () => {},
    };
    const result = await clearAuthSessionCookies({
      session,
      origins: ["https://idp.example.com", "https://idp.example.com/"],
      log: { warn: vi.fn() },
    });
    expect(result).toEqual({ ok: true, cleared: 2 });
    expect(removed).toContain("https://idp.example.com/:sid");
    expect(removed).toContain("https://idp.example.com/auth:scoped");
  });

  it("continues after an origin failure and reports partial", async () => {
    const log = vi.fn();
    const session: SessionLike = {
      cookies: {
        get: async ({ url }) => { if (url?.includes("bad")) throw new Error("boom"); return []; },
        remove: async () => {},
      },
      clearAuthCache: async () => {},
    };
    await expect(clearAuthSessionCookies({
      session,
      origins: ["https://bad.example.com", "https://ok.example.com"],
      log: { warn: log },
    })).resolves.toEqual({ ok: true, cleared: 0, partial: true });
    expect(log).toHaveBeenCalled();
  });

  it("continues removing the remaining cookies after one removal fails", async () => {
    const removed: string[] = [];
    const log = vi.fn();
    const session: SessionLike = {
      cookies: {
        get: async () => [
          { name: "failed", domain: "idp.example.com", path: "/", secure: true },
          { name: "remaining", domain: "idp.example.com", path: "/", secure: true },
        ],
        remove: async (url, name) => {
          if (name === "failed") throw new Error("remove failed");
          removed.push(`${url}:${name}`);
        },
      },
      clearAuthCache: async () => {},
    };

    await expect(clearAuthSessionCookies({
      session,
      origins: ["https://idp.example.com"],
      log: { warn: log },
    })).resolves.toEqual({ ok: true, cleared: 1, partial: true });
    expect(removed).toEqual(["https://idp.example.com/:remaining"]);
    expect(log).toHaveBeenCalled();
  });
});
