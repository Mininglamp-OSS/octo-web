import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_LAYOUT,
  isAgentProgressCard,
} from "../cardLayout";

describe("cardLayout", () => {
  it("通过 metadata.octo_layout 识别 agent progress 卡片", () => {
    expect(
      isAgentProgressCard({
        type: "AdaptiveCard",
        metadata: { octo_layout: AGENT_PROGRESS_LAYOUT },
      })
    ).toBe(true);
  });

  it("metadata 缺失或布局名不匹配时不启用专属样式", () => {
    expect(isAgentProgressCard({ type: "AdaptiveCard" })).toBe(false);
    expect(
      isAgentProgressCard({
        type: "AdaptiveCard",
        metadata: { octo_layout: "other" },
      })
    ).toBe(false);
  });
});
