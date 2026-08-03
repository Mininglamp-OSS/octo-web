import { describe, expect, it } from "vitest";
import { cardMountRootClass, resolveCardRenderProfile } from "../renderProfile";

describe("render profile selection", () => {
  it("keeps legacy and Forge root classes mutually exclusive", () => {
    expect(cardMountRootClass("legacy")).toBe("wk-interactive-card-sdk");
    const forge = cardMountRootClass("octo-chat/v1");
    expect(forge).toContain("wk-interactive-card-forge");
    expect(forge).toContain("octo-card-profile");
    expect(forge).not.toContain("wk-interactive-card-sdk");
  });

  it("accepts only the declared compatibility generation", () => {
    expect(resolveCardRenderProfile("")).toEqual({
      ok: true,
      profile: "legacy",
    });
    expect(resolveCardRenderProfile("octo-chat/v1")).toEqual({
      ok: true,
      profile: "octo-chat/v1",
    });
    expect(resolveCardRenderProfile("octo-chat@1.2.0-rc.1")).toEqual({
      ok: false,
      reason: "unsupported-render-profile",
    });
  });
});
