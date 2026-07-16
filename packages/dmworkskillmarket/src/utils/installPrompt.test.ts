import { describe, expect, it } from "vitest";
import { buildInstallPrompt, resolveAPIBaseURL } from "./installPrompt";

describe("resolveAPIBaseURL", () => {
  it("preserves the Web /api deployment prefix", () => {
    expect(resolveAPIBaseURL("/api/v1/", "https://im.deepminer.com.cn")).toBe(
      "https://im.deepminer.com.cn/api",
    );
  });

  it("removes only the API version from an absolute runtime URL", () => {
    expect(resolveAPIBaseURL("https://api.example.com/v1/", "https://app.example.com")).toBe(
      "https://api.example.com",
    );
  });
});

describe("buildInstallPrompt", () => {
  it("includes deterministic Space profile selection and login", () => {
    const prompt = buildInstallPrompt("skill-123", "space-456", "https://octo.example.com");

    expect(prompt).toContain("- Skill ID：`skill-123`");
    expect(prompt).toContain("- Space ID：`space-456`");
    expect(prompt).toContain("- API 地址：`https://octo.example.com`");
    expect(prompt).toContain("octo-cli auth list");
    expect(prompt).toContain("--profile space-space-456 --space space-456 --api-base-url https://octo.example.com");
    expect(prompt).toContain("--profile <profile> --install <skills-root>");
  });
});
