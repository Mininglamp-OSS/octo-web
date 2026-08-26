import { describe, expect, it, vi } from "vitest";

// expertService builds its own axios instance and imports @octo/base at module
// load; mock both so importing the pure serializer doesn't pull the heavy
// UI/icon graph (mirrors expertService.addToLoop.test.ts).
vi.mock("axios", () => ({
  default: { create: () => ({ interceptors: { request: { use: () => {} }, response: { use: () => {} } }, get: vi.fn(), post: vi.fn(), delete: vi.fn() }), isCancel: () => false },
}));
vi.mock("@octo/base", () => ({
  WKApp: { loginInfo: { token: "tok" }, shared: { currentSpaceId: "sp", logout: vi.fn() } },
  buildAcceptLanguage: () => "en-US",
  t: (key: string) => key,
  DEFAULT_REQUEST_TIMEOUT_MS: 20000,
}));

import { serializeMcpConfig } from "./expertService";

/**
 * Security contract: no plaintext secret VALUE may survive into the persisted
 * mcp.json attachment, regardless of the shape the user pastes. The redactor
 * must not be shape-dependent (project rule: treat pasted mcp.json as hostile).
 */
describe("serializeMcpConfig secret redaction", () => {
  const parse = (raw: string) => JSON.parse(serializeMcpConfig(raw));

  it("redacts flat string values in every secret container", () => {
    const out = parse(
      JSON.stringify({
        mcpServers: {
          g: {
            env: { API_KEY: "sk-live-123" },
            headers: { Authorization: "Bearer sk-live-456" },
            secrets: { TOKEN: "ghp_real" },
            credentials: { password: "hunter2" },
          },
        },
      })
    );
    const s = out.mcpServers.g;
    expect(s.env.API_KEY).toBe("${API_KEY}");
    expect(s.headers.Authorization).toBe("${AUTHORIZATION}");
    expect(s.secrets.TOKEN).toBe("${TOKEN}");
    expect(s.credentials.password).toBe("${PASSWORD}");
    expect(serializeMcpConfig(JSON.stringify(out))).not.toContain("sk-live");
  });

  it("redacts secrets nested deeper than one level under a container", () => {
    const raw = JSON.stringify({
      mcpServers: { g: { env: { CRED: { token: "ghp_REALSECRET" } } } },
    });
    expect(serializeMcpConfig(raw)).not.toContain("ghp_REALSECRET");
    expect(parse(raw).mcpServers.g.env.CRED.token).toBe("${TOKEN}");
  });

  it("redacts a container whose value is a bare string", () => {
    const raw = JSON.stringify({
      mcpServers: { g: { env: "API_KEY=sk-live-secret" } },
    });
    expect(serializeMcpConfig(raw)).not.toContain("sk-live-secret");
  });

  it("redacts a container whose value is an array of strings", () => {
    const raw = JSON.stringify({
      mcpServers: { g: { headers: ["Authorization: Bearer sk-secret"] } },
    });
    expect(serializeMcpConfig(raw)).not.toContain("sk-secret");
  });

  it("leaves existing ${VAR} references and reference URLs untouched (idempotent)", () => {
    const raw = JSON.stringify({
      mcpServers: {
        g: { env: { API_KEY: "${API_KEY}", VAULT: "vault://kv/token" } },
      },
    });
    const out = parse(raw);
    expect(out.mcpServers.g.env.API_KEY).toBe("${API_KEY}");
    expect(out.mcpServers.g.env.VAULT).toBe("vault://kv/token");
    // Re-serializing the redacted output is a fixed point.
    expect(serializeMcpConfig(JSON.stringify(out))).toBe(serializeMcpConfig(raw));
  });

  it("does not touch non-secret fields (command/args/url pass through)", () => {
    const raw = JSON.stringify({
      mcpServers: { g: { command: "npx", args: ["-y", "@x/y"], url: "https://x/mcp" } },
    });
    const out = parse(raw);
    expect(out.mcpServers.g.command).toBe("npx");
    expect(out.mcpServers.g.args).toEqual(["-y", "@x/y"]);
    expect(out.mcpServers.g.url).toBe("https://x/mcp");
  });

  it("returns empty string for blank input so the attachment is omitted", () => {
    expect(serializeMcpConfig("")).toBe("");
    expect(serializeMcpConfig("   ")).toBe("");
  });
});
