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
    expect(prompt).toContain("在用户明确提供附件、Skill 包路径或 Skill 目录路径前");
    expect(prompt).toContain("没有 version，使用 `1.0.0`");
    expect(prompt).toContain("<skill-package-path>");
    expect(prompt).not.toContain("<skill-zip-path>");
    expect(prompt).toContain("Space ID：`space-1`");
    expect(prompt).toContain("Prompt 中所有 Space ID 必须与 `space-1` 完全一致");
    expect(prompt).toContain('`skills.md` 中“Publish as a Bot”流程');
  });
});
