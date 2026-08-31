import { describe, it, expect } from "vitest";
import { redactMcpConfig } from "../redactMcpConfig";

describe("redactMcpConfig", () => {
  it("masks literal env/header secret values", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { url: "https://x", env: { API_KEY: "sk-live-123" }, headers: { Authorization: "Bearer t" } } },
    });
    const out = redactMcpConfig(raw);
    expect(out).not.toContain("sk-live-123");
    expect(out).not.toContain("Bearer t");
    expect(out).toContain("••••••");
    // Non-secret fields and keys are preserved.
    expect(out).toContain("https://x");
    expect(out).toContain("API_KEY");
    expect(out).toContain("Authorization");
  });

  it("leaves ${KEY} placeholders untouched and returns the input verbatim", () => {
    const raw = JSON.stringify({ mcpServers: { s: { env: { API_KEY: "${API_KEY}" } } } });
    expect(redactMcpConfig(raw)).toBe(raw);
  });

  it("returns non-secret config unchanged (preserves formatting)", () => {
    const raw = '{\n  "mcpServers": {\n    "s": { "url": "https://x" }\n  }\n}';
    expect(redactMcpConfig(raw)).toBe(raw);
  });

  it("leaves non-JSON input as-is rather than mangling it", () => {
    expect(redactMcpConfig("not json")).toBe("not json");
    expect(redactMcpConfig("")).toBe("");
  });
});
