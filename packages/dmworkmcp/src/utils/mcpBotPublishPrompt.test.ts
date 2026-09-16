import { describe, expect, it } from "vitest";
import {
  getMcpBotPublishPrompt,
  isValidMcpSpaceId,
  resolveMcpAPIBaseURL,
} from "./mcpBotPublishPrompt";

describe("isValidMcpSpaceId — server space id gate", () => {
  it("accepts a canonical UUIDv4", () => {
    expect(isValidMcpSpaceId("11111111-2222-3333-4444-555555555555")).toBe(
      true
    );
  });
  it("accepts the compact 32-hex form (no hyphens)", () => {
    // Real server-issued space ids arrive in this shape via localStorage —
    // regression guard for the sanitizer falling back to `<space-id>` when
    // the operator's actual space id is a valid 32-hex string.
    expect(isValidMcpSpaceId("9f5fda183d94482cb49bca5024439105")).toBe(true);
  });
  it("accepts uppercase / mixed-case hex", () => {
    expect(isValidMcpSpaceId("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")).toBe(
      true
    );
  });
  it("accepts a readable slug like the production `minglue_default`", () => {
    // Regression guard: production space ids are slugs (letters + `_`), not
    // hex/UUID. The old hex-only gate silently fell back to `<space-id>`, so
    // the bot prompt shipped a placeholder instead of the real space id.
    expect(isValidMcpSpaceId("minglue_default")).toBe(true);
  });
  it("trims surrounding whitespace before checking", () => {
    expect(isValidMcpSpaceId("  11111111-2222-3333-4444-555555555555  ")).toBe(
      true
    );
  });
  it.each([
    "",
    "11111111-2222-3333-4444-555555555555;rm -rf /",
    "9f5fda183d94482cb49bca5024439105;rm -rf /",
    "$(whoami)",
    "`whoami`",
    "a b",
    "id|cat",
    "x&y",
    "..",
    "-rf",
    ".hidden",
  ])("rejects shell-unsafe value %j", (bad) => {
    expect(isValidMcpSpaceId(bad)).toBe(false);
  });
});

describe("getMcpBotPublishPrompt — shell-safe interpolation", () => {
  const goodId = "11111111-2222-3333-4444-555555555555";

  it("embeds a valid UUID spaceId verbatim into the login example", () => {
    const p = getMcpBotPublishPrompt({
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
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

  it("uses the unified plugin write surface and keeps only the retained MCP probe", () => {
    const p = getMcpBotPublishPrompt({
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toContain(
      "octo-cli marketplace plugin-category list --scene-code default --plugin-type connector"
    );
    expect(p).toContain('plugin_type: "connector"');
    expect(p).toContain(
      "octo-cli marketplace mcp probe --data @connection.json"
    );
    expect(p).toContain(
      "octo-cli marketplace plugin get --plugin-id <plugin-id>"
    );
    expect(p).toContain("非字母数字字符替换为");
    expect(p).toContain("header `Authorization` 写 `${AUTHORIZATION}`");
    expect(p).toContain("`X-Api-Secret`");
    expect(p).toContain("${X_API_SECRET}");
    expect(p).toContain("`GITHUB_TOKEN` 写 `${GITHUB_TOKEN}`");
    expect(p).toContain("不要写泛化的");
    expect(p).toContain("${VAR}");
    expect(p).toContain("键 `TOKEN` 配 `${GITHUB_TOKEN}`");
    expect(p).toContain("规范化键名占位 `${TOKEN}`");
    expect(p).toContain("不得输出 `presigned_url` / `method` / `headers`");
    expect(p).toContain("不得写入 payload 文件");
    expect(p).not.toContain("marketplace mcp-category");
    expect(p).not.toContain("marketplace mcp create");
    expect(p).not.toContain("marketplace mcp get");
    expect(p).not.toContain("env_user_supplied");
    expect(p).not.toContain("headers_user_supplied");
  });

  it("embeds a compact 32-hex spaceId verbatim into the login example", () => {
    const compactId = "9f5fda183d94482cb49bca5024439105";
    const p = getMcpBotPublishPrompt({
      spaceId: compactId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toContain(`--profile space-${compactId}`);
    expect(p).toContain(`--space ${compactId}`);
  });

  it("embeds a readable slug spaceId (minglue_default) verbatim", () => {
    // Production space ids are slugs. Regression guard for the hex-only gate
    // that used to replace them with the `<space-id>` placeholder.
    const slug = "minglue_default";
    const p = getMcpBotPublishPrompt({
      spaceId: slug,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toContain(`--profile space-${slug}`);
    expect(p).toContain(`--space ${slug}`);
  });

  it.each(["$(whoami)", "; rm -rf /", "`whoami`", "|| cat /etc/passwd", ""])(
    "substitutes the <space-id> placeholder for injection payload %j (never lets it reach a shell example)",
    (payload) => {
      const p = getMcpBotPublishPrompt({
        spaceId: payload,
        apiBaseUrl: "https://example.com",
      });
      // The payload must NEVER end up in the shell example. The prompt falls
      // back to the same `<space-id>` placeholder used when no id is set,
      // forcing the operator to notice and provide a real one.
      expect(p).not.toContain(payload || "__unreachable__");
      expect(p).toContain("--profile space-<space-id>");
      expect(p).toContain("--space <space-id>");
    }
  );

  it("always ends with the authoritative-inputs footer (guard against Prompt truncation)", () => {
    const p = getMcpBotPublishPrompt({
      spaceId: goodId,
      apiBaseUrl: "https://example.com",
    });
    expect(p).toMatch(/Space ID、API 地址和可见范围是本次操作的权威输入。$/);
  });

  it("carries the 'do not output token' guard verbatim", () => {
    // Regression guard: dropping this line would produce an insecure bot run
    // with no CI signal. Externally observable — a bot receiving the prompt
    // would then execute shell commands with the token in argv.
    const p = getMcpBotPublishPrompt({ spaceId: goodId });
    expect(p).toContain("不得输出 Token");
  });

  it("places the write phase after the explicit confirmation gate", () => {
    const p = getMcpBotPublishPrompt({ spaceId: goodId });
    const gateIndex = p.indexOf("明确等待我回复“确认上架”");
    const writePhaseIndex = p.indexOf("确认后只使用 `mcp.md`");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(writePhaseIndex).toBeGreaterThan(gateIndex);
  });

  it("uses the placeholder when apiBaseUrl is empty", () => {
    const p = getMcpBotPublishPrompt({ spaceId: goodId, apiBaseUrl: "" });
    expect(p).toContain("<api-base-url>");
  });
});

describe("resolveMcpAPIBaseURL — origin normalisation", () => {
  it("returns the origin of an absolute apiURL", () => {
    expect(
      resolveMcpAPIBaseURL("https://api.example.com/market/api/v1", "https://x")
    ).toBe("https://api.example.com");
  });
  it("falls back to origin when apiURL is empty", () => {
    expect(resolveMcpAPIBaseURL("", "https://page.example.com")).toBe(
      "https://page.example.com"
    );
  });
  it("resolves a relative apiURL against origin", () => {
    expect(resolveMcpAPIBaseURL("/api/v1", "https://page.example.com")).toBe(
      "https://page.example.com"
    );
  });
});
