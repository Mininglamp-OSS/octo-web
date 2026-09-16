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
    expect(p).toContain("确认当前版本 `>= 0.15.0`");
    expect(p).toContain("按 major/minor/patch 分段数字比较");
    expect(p).toContain("版本低于 `0.15.0`");
    expect(p).toContain('npm install -g "@mininglamp-oss/octo-cli@>=0.15.0"');
    expect(p).not.toContain("@mininglamp-oss/octo-cli@'>=0.15.0'");
    expect(p).not.toContain("@mininglamp-oss/octo-cli@^0.15.0");
    expect(p).not.toContain("@mininglamp-oss/octo-cli@latest");
    expect(p).toContain("先询问用户是否更新/安装 `octo-cli`");
    expect(p).toContain("重新运行");
    expect(p).toContain("给出可复制的安装命令");
    expect(p).toContain("用户未确认时停止");
  });

  it("uses unified placeholder-shaped secret guidance", () => {
    const p = buildMcpConnectPrompt({
      mcpId,
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toContain("`env` / `headers`");
    expect(p).toContain("`${KEY}`");
    expect(p).toContain("非字母数字字符替换为 `_`");
    expect(p).toContain("`Authorization`");
    expect(p).toContain("token / key / secret / password");
    expect(p).toContain("connection_string");
    expect(p).toContain("且值为空或仍是 `${...}` 占位");
    expect(p).toContain("值已是非空真实内容时按原值接入");
    expect(p).not.toContain("env_user_supplied");
    expect(p).not.toContain("headers_user_supplied");
  });

  it.each(["$(whoami)", "; rm -rf /", "`whoami`", "|| cat /etc/passwd", ""])(
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
    expect(p).toMatch(
      /MCP ID、Space ID 和 API 地址是本次操作的权威输入。不要自行改写 ID。$/
    );
  });
});
