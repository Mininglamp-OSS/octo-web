import { describe, expect, it } from "vitest";
import { buildMcpConnectPrompt } from "./mcpConnectPrompt";

describe("buildMcpConnectPrompt — shell-safe interpolation", () => {
  const goodId = "11111111-2222-3333-4444-555555555555";
  const mcpId = "mcp_abc123";

  it("embeds the MCP ID and a valid spaceId verbatim", () => {
    const p = buildMcpConnectPrompt({
      mcpId,
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toContain(`MCP ID：\`${mcpId}\``);
    expect(p).toContain(`--profile space-${goodId}`);
    expect(p).toContain(`--space ${goodId}`);
    expect(p).toContain("https://example.com");
  });

  it.each([
    "$(whoami)",
    "; rm -rf /",
    "`whoami`",
    "|| cat /etc/passwd",
    "",
  ])(
    "substitutes the <space-id> placeholder for injection payload %j",
    (payload) => {
      const p = buildMcpConnectPrompt({
        mcpId,
        spaceId: payload,
        apiBaseUrl: "https://example.com",
      });
      expect(p).not.toContain(payload || "__unreachable__");
      expect(p).toContain("--profile space-<space-id>");
      expect(p).toContain("--space <space-id>");
    }
  );

  it("carries the 'do not output token' guard verbatim", () => {
    const p = buildMcpConnectPrompt({ mcpId, spaceId: goodId });
    expect(p).toContain("不得输出 Token");
  });

  it("uses the placeholder when apiBaseUrl is empty", () => {
    const p = buildMcpConnectPrompt({ mcpId, spaceId: goodId, apiBaseUrl: "" });
    expect(p).toContain("<api-base-url>");
  });

  it("ends with the authoritative-inputs footer (guard against truncation)", () => {
    const p = buildMcpConnectPrompt({
      mcpId,
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toMatch(/MCP ID、Space ID 和 API 地址是本次操作的权威输入。不要自行改写 ID。$/);
  });
});
