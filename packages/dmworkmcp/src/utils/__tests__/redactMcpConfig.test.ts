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

  it("masks the value after a header/env-injecting flag (--header, -e)", () => {
    const raw = JSON.stringify({
      mcpServers: {
        s: {
          command: "docker",
          args: ["run", "-i", "--rm", "-e", "API_KEY=LEAKa", "img"],
        },
        h: { command: "x", args: ["--header", "Authorization: Bearer LEAKb"] },
      },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("LEAKa");
    expect(out).not.toContain("LEAKb");
    // Benign flags/positionals survive.
    expect(out).toContain("--rm");
    expect(out).toContain("img");
  });

  it("masks a secret KEY=value positional but keeps a non-secret one", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { command: "run", args: ["API_KEY=LEAKc", "REGION=us-east-1"] } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("LEAKc");
    expect(out).toContain("REGION=us-east-1");
  });

  it("does NOT mutate a colon-bearing positional that is not a URL", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { command: "x", args: ["Authorization: Bearer keepme"] } },
    });
    const out = redactMcpConfig(raw)!;
    // new URL() would parse `authorization:` as a scheme and lowercase it; the
    // hasUrlShape guard keeps a non-URL positional byte-identical.
    expect(out).toContain("Authorization: Bearer keepme");
  });

  it("masks userinfo + fragment on a protocol-relative / relative URL", () => {
    const rel = redactMcpConfig(
      JSON.stringify({ mcpServers: { s: { url: "//user:LEAKd@mcp.example/sse" } } })
    )!;
    expect(rel).not.toContain("LEAKd");
    expect(rel).toContain("mcp.example/sse");
    const frag = redactMcpConfig(
      JSON.stringify({ mcpServers: { s: { url: "/sse#access_token=LEAKe" } } })
    )!;
    expect(frag).not.toContain("LEAKe");
    expect(frag).toContain("/sse");
  });

  it("redacts a query token in a positional-URL arg (mcp-remote bridge) but keeps the host/path", () => {
    const raw = JSON.stringify({
      mcpServers: {
        remote: {
          command: "npx",
          args: ["-y", "mcp-remote", "https://mcp.vendor.com/sse?access_token=sk-live-XXX"],
        },
      },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-XXX");
    // Bridge package name and endpoint host/path stay readable.
    expect(out).toContain("mcp-remote");
    expect(out).toContain("mcp.vendor.com/sse");
  });

  it("fails CLOSED on a non-mcpServers shape (does not leak the untrusted body)", () => {
    expect(redactMcpConfig(JSON.stringify({ secrets: { token: "sk-live-000" } }))).toBeNull();
  });

  it("fails CLOSED on a non-object server entry", () => {
    expect(redactMcpConfig(JSON.stringify({ mcpServers: { a: "sk-live-str" } }))).toBeNull();
  });

  it("DROPS a root sibling key instead of re-serializing it (rebuild, not mutate)", () => {
    const raw = JSON.stringify({
      mcpServers: { safe: { command: "npx" } },
      secrets: { token: "sk-live-ROOTSIBLING" },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-ROOTSIBLING");
    expect(out).not.toContain("secrets");
    expect(out).toContain("npx");
  });

  it("DROPS a VS Code top-level inputs array (credential defaults live there)", () => {
    const raw = JSON.stringify({
      inputs: [{ id: "tok", password: true, default: "sk-live-VSCODEINPUT" }],
      mcpServers: { safe: { command: "npx", args: ["-y", "pkg"] } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-VSCODEINPUT");
    expect(out).not.toContain("inputs");
  });

  it("DROPS an unmodeled server key and a mistyped tool allow-list instead of leaking them", () => {
    const raw = JSON.stringify({
      mcpServers: {
        s: {
          type: "sse",
          url: "https://x",
          token: "sk-live-SRVKEY",
          name: "sk-live-NAME",
          autoApprove: { token: "sk-live-AUTOAPPROVE" },
        },
      },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-SRVKEY");
    expect(out).not.toContain("sk-live-NAME");
    expect(out).not.toContain("sk-live-AUTOAPPROVE");
    // Modeled fields still render.
    expect(out).toContain("https://x");
    expect(out).toContain("sse");
  });

  it("DROPS a non-string url and a non-array args (wrong-typed modeled keys)", () => {
    const raw = JSON.stringify({
      mcpServers: {
        x: { url: { href: "https://h/?t=sk-live-OBJURL" }, args: { a: "sk-live-OBJARGS" } },
      },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-OBJURL");
    expect(out).not.toContain("sk-live-OBJARGS");
  });

  it("masks a schemeless host+query positional arg (redactUrl runs unconditionally)", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { command: "run", args: ["example.com/path?token=sk-live-NOSCHEME"] } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-NOSCHEME");
    expect(out).toContain("example.com/path");
  });

  it("masks a URL fragment token", () => {
    const raw = JSON.stringify({
      mcpServers: { s: { url: "https://h/sse#access_token=sk-live-FRAG" } },
    });
    const out = redactMcpConfig(raw)!;
    expect(out).not.toContain("sk-live-FRAG");
    expect(out).toContain("h/sse");
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
