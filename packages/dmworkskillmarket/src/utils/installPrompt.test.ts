import { describe, expect, it } from "vitest";
import { buildInstallPrompt, resolveAPIBaseURL } from "./installPrompt";

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
    expect(prompt).toContain("当前 Agent Runtime 中配置的 Octo Bot Token");
    expect(prompt).toContain("OCTO_BOT_TOKEN");
    expect(prompt).toContain("当前 Agent Runtime 自身管理的 Octo 凭据或本地配置");
    expect(prompt).not.toContain("~/.openclaw/");
    expect(prompt).toContain("当前工作目录的 `.env`");
    expect(prompt).toContain("可搜索当前 Runtime 的官方文档或教程");
    expect(prompt).toContain("仅查找凭据读取方式");
    expect(prompt).toContain("octo-cli auth login");
    expect(prompt).toContain("找不到可用凭据时");
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
