// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_FALLBACK_CLASS,
  applyAgentProgressFallbackVisual,
} from "../sdk/agentProgressFallback";
import {
  buildRenderedCardKey,
  classifyCardReconcile,
} from "../cardReconcile";

const card = {
  type: "AdaptiveCard",
  version: "1.5",
  body: [{ type: "TextBlock", text: "🤖 正在处理…" }],
};

function mountSdkDom(target: HTMLElement): void {
  target.innerHTML = `
    <div class="ac-adaptiveCard">
      <div id="timeline_detail">
        <div class="ac-container"><div class="ac-richTextBlock">⏳ 执行命令：export</div></div>
      </div>
    </div>
  `;
}

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

  it("apply 保留现有 DOM；retract 通过 remount 清除 class 并还原 ⏳", () => {
    const target = document.createElement("div");
    mountSdkDom(target);
    const originalTimeline = target.querySelector("#timeline_detail");
    const key = buildRenderedCardKey("legacy", true, card);

    const applyAction = classifyCardReconcile(key, false, key, true);
    expect(applyAction).toBe("fallback-only");
    applyAgentProgressFallbackVisual(target);
    // apply 不能替换 SDK DOM，否则会丢失展开/输入等交互态。
    expect(target.querySelector("#timeline_detail")).toBe(originalTimeline);
    expect(target.textContent).toContain("⚠️ 执行命令");

    const retractAction = classifyCardReconcile(key, true, key, false);
    expect(retractAction).toBe("remount");
    // 与 InteractiveCardCell 的 remount 分支一致：SDK 从权威 card JSON 重建 DOM。
    mountSdkDom(target);
    const remountedTimeline = target.querySelector("#timeline_detail");
    expect(remountedTimeline).not.toBe(originalTimeline);
    expect(remountedTimeline?.classList.contains(AGENT_PROGRESS_FALLBACK_CLASS)).toBe(false);
    expect(target.textContent).toContain("⏳ 执行命令");
    expect(target.textContent).not.toContain("⚠️");
  });
});
