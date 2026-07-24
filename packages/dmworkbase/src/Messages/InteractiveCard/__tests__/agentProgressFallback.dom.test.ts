// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_FALLBACK_CLASS,
  applyAgentProgressFallbackVisual,
} from "../sdk/agentProgressFallback";

describe("applyAgentProgressFallbackVisual", () => {
  it("把运行中步骤的沙漏 ⏳ 换成 ⚠️ 并给 timeline 打标记类", () => {
    const target = document.createElement("div");
    target.innerHTML = `
      <div class="ac-adaptiveCard">
        <div id="timeline_detail">
          <div class="ac-container"><div class="ac-richTextBlock">⏳ 执行命令：export</div></div>
          <div class="ac-container"><div class="ac-richTextBlock">✅ 读取文件 · 1s</div></div>
        </div>
      </div>
    `;

    applyAgentProgressFallbackVisual(target);

    const timeline = target.querySelector<HTMLElement>("#timeline_detail");
    expect(timeline?.classList.contains(AGENT_PROGRESS_FALLBACK_CLASS)).toBe(
      true
    );
    expect(timeline?.textContent).toContain("⚠️ 执行命令");
    expect(timeline?.textContent).not.toContain("⏳");
    // 非运行中步骤保持不变
    expect(timeline?.textContent).toContain("✅ 读取文件");
  });

  it("无 timeline 容器时安全 no-op", () => {
    const target = document.createElement("div");
    target.innerHTML = `<div class="ac-adaptiveCard"><div class="ac-textBlock">纯文本</div></div>`;
    expect(() => applyAgentProgressFallbackVisual(target)).not.toThrow();
  });
});
