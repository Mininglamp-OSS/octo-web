import { describe, it, expect } from "vitest";
import { redactMcpConfig } from "../redactMcpConfig";

describe("redactMcpConfig", () => {
  it("masks literal env/header secret values, keeps keys + endpoint host", () => {
    const raw = JSON.stringify({
      mcpServers: {
        s: {
          url: "https://x",
          env: { API_KEY: "sk-live-123" },
          headers: { Authorization: "Bearer t" },
        },
      },
    });
    const out = redactMcpConfig(raw);
    expect(out).not.toContain("sk-live-123");
    expect(out).not.toContain("Bearer t");
    expect(out).toContain("••••••");
    // Non-secret host and the keys survive so a viewer sees what's needed.
    expect(out).toContain("https://x");
    expect(out).toContain("API_KEY");
    expect(out).toContain("Authorization");
  });

  it("keeps an EXACT ${KEY} placeholder but re-serializes (no verbatim leak path)", () => {
    const raw = JSON.stringify({ mcpServers: { s: { env: { API_KEY: "${API_KEY}" } } } });
    const out = redactMcpConfig(raw);
    expect(out).toContain("${API_KEY}");
    expect(out).not.toContain("••••••");
  });

  it("masks a value that only CONTAINS ${…} (substring is not a placeholder)", () => {
    const raw = JSON.stringify({ mcpServers: { s: { env: { API_KEY: "sk-live-abc${X}" } } } });
    const out = redactMcpConfig(raw);
    expect(out).not.toContain("sk-live-abc");
    expect(out).toContain("••••••");
  });

  it("masks a URL query token + userinfo but keeps scheme/host/path", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { url: "https://user:pass@mcp.example.com/sse?apikey=sk-live-999&v=2" } },
    });
    const out = redactMcpConfig(raw);
    expect(out).not.toContain("sk-live-999");
    expect(out).not.toContain("pass");
    expect(out).toContain("mcp.example.com/sse");
  });

  it("masks positional stdio args but keeps flags", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { command: "npx", args: ["--token", "sk-live-777", "-y"] } },
    });
    const out = redactMcpConfig(raw);
    expect(out).not.toContain("sk-live-777");
    expect(out).toContain("--token");
    expect(out).toContain("-y");
  });

  it("fails CLOSED on a non-mcpServers shape (does not leak the untrusted body)", () => {
    const raw = JSON.stringify({ secrets: { token: "sk-live-000" } });
    expect(redactMcpConfig(raw)).toBeNull();
  });

  it("fails CLOSED on malformed JSON rather than echoing it back", () => {
    expect(redactMcpConfig('{"mcpServers": {')).toBeNull();
    expect(redactMcpConfig("not json")).toBeNull();
  });

  it("passes an empty/blank input through untouched", () => {
    expect(redactMcpConfig("")).toBe("");
    expect(redactMcpConfig("   ")).toBe("   ");
  });
});
