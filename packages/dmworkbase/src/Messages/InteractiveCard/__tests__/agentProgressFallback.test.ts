import { describe, expect, it } from "vitest";
import { AGENT_PROGRESS_LAYOUT } from "../cardLayout";
import {
  CARD_FALLBACK_MIN_IDLE_SEC,
  getProgressCardHeaderText,
  isNonTerminalProgressCard,
  isProgressCardIdleEnough,
} from "../agentProgressFallback";

/** 构造一张与 openclaw card-render 输出同形的 progress 卡（header 为 RichTextBlock）。 */
function progressCard(
  headerText: string,
  opts: { layout?: boolean; rich?: boolean } = {}
): Record<string, unknown> {
  const { layout = true, rich = true } = opts;
  const headerItem = rich
    ? {
        type: "RichTextBlock",
        inlines: [{ type: "TextRun", text: headerText, weight: "Bolder" }],
      }
    : { type: "TextBlock", text: headerText, weight: "Bolder" };
  const card: Record<string, unknown> = {
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      {
        type: "ColumnSet",
        columns: [{ type: "Column", width: "stretch", items: [headerItem] }],
      },
      { type: "Container", id: "timeline_detail", items: [] },
    ],
  };
  if (layout) card.metadata = { octo_layout: AGENT_PROGRESS_LAYOUT };
  return card;
}

describe("getProgressCardHeaderText", () => {
  it("从 RichTextBlock header 拼接文本", () => {
    expect(getProgressCardHeaderText(progressCard("🤖 正在处理…"))).toBe(
      "🤖 正在处理…"
    );
  });

  it("从 TextBlock header 取文本", () => {
    expect(
      getProgressCardHeaderText(
        progressCard("✅ 已完成 · 3 步", { rich: false })
      )
    ).toBe("✅ 已完成 · 3 步");
  });

  it("结构异常（无 ColumnSet）返回 null", () => {
    expect(
      getProgressCardHeaderText({ type: "AdaptiveCard", body: [] })
    ).toBeNull();
    expect(getProgressCardHeaderText({ type: "AdaptiveCard" })).toBeNull();
  });
});

describe("isNonTerminalProgressCard", () => {
  it("进行中 header（🤖 / ⏳）→ 触发", () => {
    expect(isNonTerminalProgressCard(progressCard("🤖 正在处理…"))).toBe(true);
    expect(isNonTerminalProgressCard(progressCard("🤖 思考中…"))).toBe(true);
    expect(isNonTerminalProgressCard(progressCard("🤖 正在整理结果"))).toBe(
      true
    );
    expect(isNonTerminalProgressCard(progressCard("⏳ 执行命令"))).toBe(true);
  });

  it("终态 header（✅ / ⚠️ / ❌ / ⏹ / ⏱）→ 不触发", () => {
    expect(isNonTerminalProgressCard(progressCard("✅ 已完成 · 3 步"))).toBe(
      false
    );
    expect(isNonTerminalProgressCard(progressCard("⚠️ 已中断：boom"))).toBe(
      false
    );
    expect(isNonTerminalProgressCard(progressCard("❌ 出错"))).toBe(false);
    expect(isNonTerminalProgressCard(progressCard("⏹ 已停止"))).toBe(false);
    expect(isNonTerminalProgressCard(progressCard("⏱️ 等待超时"))).toBe(false);
  });

  it("等待子任务（⏸️）不介入", () => {
    expect(isNonTerminalProgressCard(progressCard("⏸️ 等待任务结果"))).toBe(
      false
    );
  });

  it("非 agent_progress 卡不触发", () => {
    expect(
      isNonTerminalProgressCard(progressCard("🤖 正在处理…", { layout: false }))
    ).toBe(false);
  });

  it("未识别 header 保守不触发", () => {
    expect(isNonTerminalProgressCard(progressCard("普通标题"))).toBe(false);
  });
});

describe("isProgressCardIdleEnough", () => {
  it("空闲 ≥ 阈值 → true", () => {
    expect(
      isProgressCardIdleEnough(100, 100 + CARD_FALLBACK_MIN_IDLE_SEC)
    ).toBe(true);
    expect(isProgressCardIdleEnough(100, 110)).toBe(true);
  });

  it("空闲 < 阈值（快速动作序列）→ false", () => {
    expect(isProgressCardIdleEnough(100, 101)).toBe(false);
  });

  it("未记录 patch 时刻 → 保守 false", () => {
    expect(isProgressCardIdleEnough(undefined, 100)).toBe(false);
  });
});
