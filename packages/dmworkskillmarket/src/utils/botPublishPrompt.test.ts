import { describe, expect, it } from "vitest";
import { getBotPublishPrompt } from "./botPublishPrompt";

describe("getBotPublishPrompt", () => {
  it("requires the user to provide an accessible package before publishing", () => {
    const prompt = getBotPublishPrompt({
      spaceId: "space-1",
      apiBaseUrl: "https://octo.example.com/api",
    });

    expect(prompt).toContain("请上传要上架的 `.zip` / `.skill` 包");
    expect(prompt).toContain("不要解释正在读取 Skill");
    expect(prompt).toContain("逐步播报检查过程");
    expect(prompt).toContain("Skill 包或 Skill 目录位置");
    expect(prompt).not.toContain("点击输入框旁");
    expect(prompt).not.toContain("拖入当前对话");
    expect(prompt).toContain("用户提供前不要为查找 Skill 包搜索磁盘或猜测路径");
    expect(prompt).not.toContain("<skill-package-path>");
    expect(prompt).not.toContain("<skill-zip-path>");
    expect(prompt).toContain("Space ID：`space-1`");
    expect(prompt).toContain("当前 Agent Runtime 中配置的 Octo Bot Token");
    expect(prompt).toContain("OCTO_BOT_TOKEN");
    expect(prompt).toContain("当前 Agent Runtime 自身管理的 Octo 凭据或本地配置");
    expect(prompt).toContain("随 Runtime 分发的本地文档");
    expect(prompt).not.toContain("~/.openclaw/");
    expect(prompt).toContain("当前工作目录的 `.env`");
    expect(prompt).toContain("不要为获取 Token 搜索网络或访问外部文档");
    expect(prompt).not.toContain("可搜索当前 Runtime");
    expect(prompt).toContain("octo-cli auth login");
    expect(prompt).toContain("以上来源都找不到时，不要继续自行查找");
    expect(prompt).toContain('`skills.md` 中“Publish as a Bot”流程');
    expect(prompt).toContain("使用用户提供的附件、Skill 包路径或");
    expect(prompt).toContain("以上 Space ID、API 地址和可见范围是本次操作的权威输入");
    expect(prompt).not.toContain("在上传或覆盖现有 Skill 前，向用户展示");
    expect(prompt).not.toContain("go install github.com/Mininglamp-OSS/octo-cli");
  });

  it("falls back to a placeholder when spaceId is not shell-safe", () => {
    const payload = "space-1$(whoami)";
    const prompt = getBotPublishPrompt({
      spaceId: payload,
      apiBaseUrl: "https://octo.example.com/api",
    });

    expect(prompt).not.toContain(payload);
    expect(prompt).toContain("- Space ID：`<space-id>`");
    expect(prompt).toContain("--profile space-<space-id> --space <space-id>");
  });
});
