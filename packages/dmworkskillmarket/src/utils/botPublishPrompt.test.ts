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
    expect(prompt).toContain("用户提供前不要搜索磁盘或猜测路径");
    expect(prompt).not.toContain("<skill-package-path>");
    expect(prompt).not.toContain("<skill-zip-path>");
    expect(prompt).toContain("Space ID：`space-1`");
    expect(prompt).toContain('`skills.md` 中“Publish as a Bot”流程');
    expect(prompt).toContain("使用用户提供的附件、Skill 包路径或");
    expect(prompt).toContain("以上 Space ID、API 地址和可见范围是本次操作的权威输入");
    expect(prompt).not.toContain("在上传或覆盖现有 Skill 前，向用户展示");
    expect(prompt).not.toContain("go install github.com/Mininglamp-OSS/octo-cli");
  });
});
