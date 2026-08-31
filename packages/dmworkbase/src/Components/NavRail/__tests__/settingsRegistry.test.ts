import { describe, expect, it } from "vitest";
import { getAvailableSettingsGroups } from "../settingsRegistry";

const environment = (target: "web" | "desktop") => ({
  target,
  shell: target === "desktop" ? "electron" as const : null,
  os: "unknown" as const,
  capabilities: new Set(["voiceInput" as const]),
});

const itemIds = (target: "web" | "desktop") =>
  getAvailableSettingsGroups({ environment: environment(target) })
    .flatMap((group) => group.items.map((item) => item.id));

describe("settings registry", () => {
  it("keeps web settings focused on supported pages", () => {
    expect(itemIds("web")).toEqual([
      "general",
      "account",
      "notifications",
      "voice",
      "shortcuts",
      "devices",
      "about",
    ]);
  });

  it("keeps account settings available with or without an external account center", () => {
    expect(itemIds("web")).toContain("account");
  });

  it("adds desktop behavior and downloads only for desktop runtime", () => {
    expect(itemIds("desktop")).toEqual([
      "general",
      "account",
      "notifications",
      "voice",
      "desktop-behavior",
      "downloads",
      "trusted-domains",
      "shortcuts",
      "devices",
      "about",
    ]);
  });

  it("never exposes trusted domains on web", () => {
    expect(itemIds("web")).not.toContain("trusted-domains");
  });
});
