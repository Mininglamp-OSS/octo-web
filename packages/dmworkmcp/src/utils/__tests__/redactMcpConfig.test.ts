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
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-123");
    expect(out).not.toContain("Bearer t");
    expect(out).toContain("••••••");
    expect(out).toContain("https://x");
    expect(out).toContain("API_KEY");
    expect(out).toContain("Authorization");
  });

  it("keeps an EXACT ${KEY} placeholder but re-serializes (no verbatim leak path)", () => {
    const raw = JSON.stringify({ mcpServers: { s: { env: { API_KEY: "${API_KEY}" } } } });
    const out = redactMcpConfig(raw)!;
    expect(out).toContain("${API_KEY}");
    expect(out).not.toContain("••••••");
  });

  it("masks a value that only CONTAINS ${…} (substring is not a placeholder)", () => {
    const raw = JSON.stringify({ mcpServers: { s: { env: { API_KEY: "sk-live-abc${X}" } } } });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-abc");
    expect(out).toContain("••••••");
  });

  it("masks a non-string env/header value (never renders it raw)", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { headers: { Authorization: { token: "sk-live-789" } } } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-789");
    expect(out).toContain("••••••");
  });

  it("masks a URL query token + userinfo (ASCII, no mojibake) but keeps host/path", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { url: "https://user:pass@mcp.example.com/sse?apikey=sk-live-999&v=2" } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-999");
    expect(out).not.toContain("pass");
    expect(out).toContain("mcp.example.com/sse");
    // No percent-encoded Unicode mask artifact.
    expect(out).not.toContain("%E2%80%A2");
  });

  it("masks EVERY value of a duplicated query key (no first-value bypass)", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { url: "https://h/sse?token=${TOKEN}&token=sk-live-LEAK" } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-LEAK");
  });

  it("keeps a query-less relative URL as-is but strips a relative query string", () => {
    const kept = redactMcpConfig(
      JSON.stringify({ mcpServers: { s: { url: "/sse" } } })
    )!;
    expect(kept).toContain("/sse");
    const stripped = redactMcpConfig(
      JSON.stringify({ mcpServers: { s: { url: "/sse?token=sk-live-REL" } } })
    )!;
    expect(stripped).not.toContain("sk-live-REL");
    expect(stripped).toContain("/sse");
  });

  it("masks the value in a --flag=value arg but keeps flags and positionals", () => {
    const raw = JSON.stringify({
      mcpServers: {
        s: { command: "npx", args: ["-y", "@modelcontextprotocol/server-fs", "--api-key=sk-live-INLINE"] },
      },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-INLINE");
    expect(out).toContain("--api-key");
    // Positional package name is informational — kept.
    expect(out).toContain("@modelcontextprotocol/server-fs");
    expect(out).toContain("-y");
  });

  it("masks the value after a secret-named flag but keeps a value after a benign flag", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { command: "run", args: ["--token", "sk-live-SPLIT", "--port", "8080"] } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-SPLIT");
    expect(out).toContain("--token");
    expect(out).toContain("8080");
  });

  it("fails CLOSED on a non-mcpServers shape (does not leak the untrusted body)", () => {
    expect(redactMcpConfig(JSON.stringify({ secrets: { token: "sk-live-000" } }))).toBeNull();
  });

  it("fails CLOSED on a non-object server entry", () => {
    expect(redactMcpConfig(JSON.stringify({ mcpServers: { a: "sk-live-str" } }))).toBeNull();
  });

  it("fails CLOSED on a server carrying an unmodeled (possibly secret) key", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { type: "sse", url: "https://x", token: "sk-live-456" } },
    });
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
