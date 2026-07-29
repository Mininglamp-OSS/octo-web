import { describe, expect, it } from "vitest";
import { getMcpAvatarColor, getMcpAvatarText } from "./mcpAvatar";

describe("getMcpAvatarColor — id-keyed, deterministic", () => {
  it("returns the same color for the same id across calls", () => {
    const a = getMcpAvatarColor("mcp-42");
    const b = getMcpAvatarColor("mcp-42");
    expect(a).toBe(b);
  });

  it("keys on id, not display name — two MCPs with the same name still get distinct-looking backgrounds", () => {
    // The palette has only 6 slots so we can't guarantee two ids collide to
    // DIFFERENT colors, but the contract is `color = f(id)` — a regression to
    // `f(name)` would return the same color for these two rows regardless of
    // id, and this asserts that at least SOME id pair produces a different
    // color to prove the id is being read.
    const swatches = new Set<string>();
    for (let i = 0; i < 24; i++) swatches.add(getMcpAvatarColor(`mcp-${i}`));
    expect(swatches.size).toBeGreaterThan(1);
  });

  it("empty id falls back to a fixed slot without throwing", () => {
    expect(() => getMcpAvatarColor("")).not.toThrow();
    expect(typeof getMcpAvatarColor("")).toBe("string");
  });
});

describe("getMcpAvatarText — display-char extraction", () => {
  it("empty name → literal M", () => {
    expect(getMcpAvatarText("")).toBe("M");
    expect(getMcpAvatarText("   ")).toBe("M");
  });

  it("CJK name → first TWO wide chars (regression guard against slice(0,1))", () => {
    expect(getMcpAvatarText("数据服务")).toBe("数据");
    expect(getMcpAvatarText("数据")).toBe("数据");
  });

  it("single CJK char → that char alone", () => {
    expect(getMcpAvatarText("数")).toBe("数");
  });

  it("all-digit name → first two digits", () => {
    expect(getMcpAvatarText("12345")).toBe("12");
    expect(getMcpAvatarText("7")).toBe("7");
  });

  it("multi-token latin name → uppercase initials of the first two tokens", () => {
    expect(getMcpAvatarText("my-cool-mcp")).toBe("MC");
    expect(getMcpAvatarText("hello world")).toBe("HW");
    expect(getMcpAvatarText("data.service")).toBe("DS");
    expect(getMcpAvatarText("data_service")).toBe("DS");
  });

  it("single latin token → first char uppercased", () => {
    expect(getMcpAvatarText("github")).toBe("G");
  });

  it("mixed CJK + latin → CJK branch wins (matches design)", () => {
    expect(getMcpAvatarText("Github 工具")).toBe("工具");
  });
});
