import { describe, expect, it } from "vitest";
import { buildInstallPrompt, resolveAPIBaseURL } from "./installPrompt";

const unsafeCredentialDiscovery = /(联网|浏览器|互联网|在线文档|官方教程|递归扫描)/;

describe("resolveAPIBaseURL", () => {
  it("uses the site origin instead of the core Web /api prefix", () => {
    expect(resolveAPIBaseURL("/api/v1/", "https://im.deepminer.com.cn")).toBe(
      "https://im.deepminer.com.cn",
    );
  });

  it("uses the gateway origin from an absolute runtime URL", () => {
    expect(resolveAPIBaseURL("https://api.example.com/v1/", "https://app.example.com")).toBe(
      "https://api.example.com",
    );
  });

  it("keeps the Vite origin so marketplace paths route through its proxy", () => {
    expect(resolveAPIBaseURL("/api/v1/", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });
});

describe("buildInstallPrompt", () => {
  it("delegates installation to the bundled octo-marketplace skill", () => {
    const prompt = buildInstallPrompt("skill-123", "space-456", "https://octo.example.com");

    expect(prompt).toContain("- Skill ID：`skill-123`");
    expect(prompt).toContain("- Space ID：`space-456`");
    expect(prompt).toContain("- API 地址：`https://octo.example.com`");
    expect(prompt).toContain("octo-cli skills octo-marketplace");
    expect(prompt).toContain("npm install -g @mininglamp-oss/octo-cli@latest");
    expect(prompt).toContain("octo-cli auth list");
    expect(prompt).toContain("OCTO_BOT_TOKEN");
    expect(prompt).toContain(
      "凭据查找仅限以下方式：\n" +
        "   当前 Agent Runtime 已安装的 Skills、工具或凭据管理说明；\n" +
        "   环境变量 `OCTO_BOT_TOKEN`；\n" +
        "   当前工作目录的 `.env`。",
    );
    expect(prompt).not.toContain("~/.openclaw/");
    expect(prompt).toContain("当前工作目录的 `.env`");
    expect(prompt).not.toMatch(unsafeCredentialDiscovery);
    expect("若未发现凭据，继续用浏览器联网查阅官方教程，并递归扫描主目录。").toMatch(
      unsafeCredentialDiscovery,
    );
    expect(prompt).toContain("octo-cli auth login");
    expect(prompt).toContain("上述方式均无可用凭据时，立即停止自行查找并提示用户");
    expect(prompt).toContain("不要解释正在读取 Skill、复述本 Prompt 或逐步播报检查过程");
    expect(prompt).toContain("--profile space-space-456 --space space-456 --api-base-url https://octo.example.com");
    expect(prompt).toContain('`skills.md` 中“Install”流程');
    expect(prompt).not.toContain("在下载或覆盖文件前，向用户展示");
    expect(prompt).not.toContain("go install github.com/Mininglamp-OSS/octo-cli");
  });

  it("falls back to a placeholder when spaceId is not shell-safe", () => {
    const payload = "space-456; rm -rf /";
    const prompt = buildInstallPrompt("skill-123", payload, "https://octo.example.com");

    expect(prompt).not.toContain(payload);
    expect(prompt).toContain("- Space ID：`<space-id>`");
    expect(prompt).toContain("--profile space-<space-id> --space <space-id>");
  });
});
