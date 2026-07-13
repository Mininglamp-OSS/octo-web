// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { AGENT_PROGRESS_LAYOUT } from "../cardLayout";
import { enhanceAgentProgressLayout } from "../sdk/agentProgressLayout";

describe("agentProgressLayout", () => {
  it("收敛 agent progress 中 SDK inline 的状态块背景和 padding", () => {
    const target = document.createElement("div");
    target.innerHTML = `
      <div class="ac-adaptiveCard">
        <div id="timeline_detail">
          <div class="ac-container" style="padding: 16px; background-color: rgb(254, 242, 242);">
            <div class="ac-richTextBlock">❌ 读取文件</div>
          </div>
        </div>
      </div>
    `;

    enhanceAgentProgressLayout(
      {
        type: "AdaptiveCard",
        metadata: { octo_layout: AGENT_PROGRESS_LAYOUT },
      },
      target
    );

    const step = target.querySelector<HTMLElement>(
      ".wk-interactive-card-progress-step--status"
    );
    expect(step).not.toBeNull();
    expect(step?.style.backgroundColor).toBe("");
    expect(step?.style.padding).toBe("");
  });

  it("非 agent progress 卡片不处理 DOM", () => {
    const target = document.createElement("div");
    target.innerHTML = `
      <div id="timeline_detail">
        <div class="ac-container" style="padding: 16px; background-color: rgb(254, 242, 242);"></div>
      </div>
    `;

    enhanceAgentProgressLayout({ type: "AdaptiveCard" }, target);

    const step = target.querySelector<HTMLElement>(".ac-container");
    expect(step?.classList.contains("wk-interactive-card-progress-step")).toBe(
      false
    );
    expect(
      step?.classList.contains("wk-interactive-card-progress-step--status")
    ).toBe(false);
    expect(step?.style.backgroundColor).toBe("rgb(254, 242, 242)");
    expect(step?.style.padding).toBe("16px");
  });
});
