import { describe, expect, it } from "vitest";
import {
  getMcpBotPublishPrompt,
  isValidMcpSpaceId,
  resolveMcpAPIBaseURL,
} from "./mcpBotPublishPrompt";

describe("isValidMcpSpaceId — server space id gate", () => {
  it("accepts a canonical UUIDv4", () => {
    expect(isValidMcpSpaceId("11111111-2222-3333-4444-555555555555")).toBe(true);
  });
  it("accepts the compact 32-hex form (no hyphens)", () => {
    // Real server-issued space ids arrive in this shape via localStorage —
    // regression guard for the sanitizer falling back to `<space-id>` when
    // the operator's actual space id is a valid 32-hex string.
    expect(isValidMcpSpaceId("9f5fda183d94482cb49bca5024439105")).toBe(true);
  });
  it("accepts uppercase / mixed-case hex", () => {
    expect(isValidMcpSpaceId("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(true);
  });
  it("trims surrounding whitespace before checking", () => {
    expect(isValidMcpSpaceId("  11111111-2222-3333-4444-555555555555  ")).toBe(true);
  });
  it.each([
    "",
    "not-a-uuid",
    "11111111-2222-3333-4444-555555555555;rm -rf /",
    "9f5fda183d94482cb49bca5024439105;rm -rf /",
    "$(whoami)",
    "..",
    "11111111-2222-3333-4444",
    // 31 hex chars — one short of the compact form
    "9f5fda183d94482cb49bca502443910",
    // 33 hex chars — one over
    "9f5fda183d94482cb49bca50244391055",
  ])("rejects malformed value %j", (bad) => {
    expect(isValidMcpSpaceId(bad)).toBe(false);
  });
});

describe("getMcpBotPublishPrompt — shell-safe interpolation", () => {
  const goodId = "11111111-2222-3333-4444-555555555555";

  it("embeds a valid UUID spaceId verbatim into the login example", () => {
    const p = getMcpBotPublishPrompt({ spaceId: goodId, apiBaseUrl: "https://example.com" });
    expect(p).toContain(`--profile space-${goodId}`);
    expect(p).toContain(`--space ${goodId}`);
    expect(p).toContain("https://example.com");
  });

  it("embeds a compact 32-hex spaceId verbatim into the login example", () => {
    const compactId = "9f5fda183d94482cb49bca5024439105";
    const p = getMcpBotPublishPrompt({ spaceId: compactId, apiBaseUrl: "https://example.com" });
    expect(p).toContain(`--profile space-${compactId}`);
    expect(p).toContain(`--space ${compactId}`);
  });

  it.each([
    "$(whoami)",
    "; rm -rf /",
    "`whoami`",
    "|| cat /etc/passwd",
    "not-a-uuid",
    "",
  ])("substitutes the <space-id> placeholder for injection payload %j (never lets it reach a shell example)", (payload) => {
    const p = getMcpBotPublishPrompt({ spaceId: payload, apiBaseUrl: "https://example.com" });
    // The payload must NEVER end up in the shell example. The prompt falls
    // back to the same `<space-id>` placeholder used when no id is set,
    // forcing the operator to notice and provide a real one.
    expect(p).not.toContain(payload || "__unreachable__");
    expect(p).toContain("--profile space-<space-id>");
    expect(p).toContain("--space <space-id>");
  });

  it("always ends with the authoritative-inputs footer (guard against Prompt truncation)", () => {
    const p = getMcpBotPublishPrompt({ spaceId: goodId, apiBaseUrl: "https://example.com" });
    expect(p).toMatch(/Space ID、API 地址和可见范围是本次操作的权威输入。$/);
  });

  it("carries the 'do not output token' guard verbatim", () => {
    // Regression guard: dropping this line would produce an insecure bot run
    // with no CI signal. Externally observable — a bot receiving the prompt
    // would then execute shell commands with the token in argv.
    const p = getMcpBotPublishPrompt({ spaceId: goodId });
    expect(p).toContain("不得输出 Token");
  });

  it("uses the placeholder when apiBaseUrl is empty", () => {
    const p = getMcpBotPublishPrompt({ spaceId: goodId, apiBaseUrl: "" });
    expect(p).toContain("<api-base-url>");
  });
});

describe("resolveMcpAPIBaseURL — origin normalisation", () => {
  it("returns the origin of an absolute apiURL", () => {
    expect(resolveMcpAPIBaseURL("https://api.example.com/market/api/v1", "https://x")).toBe(
      "https://api.example.com"
    );
  });
  it("falls back to origin when apiURL is empty", () => {
    expect(resolveMcpAPIBaseURL("", "https://page.example.com")).toBe("https://page.example.com");
  });
  it("resolves a relative apiURL against origin", () => {
    expect(resolveMcpAPIBaseURL("/api/v1", "https://page.example.com")).toBe(
      "https://page.example.com"
    );
  });
});
