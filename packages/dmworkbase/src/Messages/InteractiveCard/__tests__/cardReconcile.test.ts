// WS-99 评审 P1 回归（纯函数级）：验证 InteractiveCardCell 的 reconcile 决策。
//
// 关键不变量：本地兜底标记 (localFallbackApplied) 翻转**不改变** renderedKey，因此不会被判成
// 「新帧到达」而走重挂载/重置分支——那会折叠用户已展开的 timeline 并静默作废在飞的
// Action.Submit（submitGen++/清 submitting/submitError）。这里在无重型组件图依赖下锁住该决策。

import { describe, expect, it } from "vitest";
import {
  buildRenderedCardKey,
  classifyCardReconcile,
} from "../cardReconcile";

const card = (header: string): Record<string, unknown> => ({
  type: "AdaptiveCard",
  version: "1.5",
  body: [{ type: "TextBlock", text: header }],
  metadata: { octo_layout: "agent_progress_v1" },
});

describe("buildRenderedCardKey", () => {
  it("同一 card 内容/渲染 profile → 稳定指纹", () => {
    const c = card("🤖 正在处理…");
    expect(buildRenderedCardKey("legacy", true, c)).toBe(
      buildRenderedCardKey("legacy", true, c)
    );
  });

  it("card 内容变化 → 指纹变化", () => {
    expect(buildRenderedCardKey("legacy", true, card("第 1 步"))).not.toBe(
      buildRenderedCardKey("legacy", true, card("第 2 步"))
    );
  });

  it("renderProfile / allowInteractive 变化 → 指纹变化", () => {
    const c = card("x");
    expect(buildRenderedCardKey("legacy", true, c)).not.toBe(
      buildRenderedCardKey("forge", true, c)
    );
    expect(buildRenderedCardKey("legacy", true, c)).not.toBe(
      buildRenderedCardKey("legacy", false, c)
    );
  });

  it("指纹**不含** fallbackFinalized：本地兜底标记不参与内容 key（P1 核心）", () => {
    // key 由 buildRenderedCardKey 计算，签名里根本没有 fallback 维度——同内容同 profile，
    // 无论兜底与否都得到同一 key，故仅兜底翻转不会触发重挂载。
    const c = card("🤖 正在处理…");
    const key = buildRenderedCardKey("legacy", true, c);
    // 兜底态由 classifyCardReconcile 的独立维度处理，见下。
    expect(key.includes("fb")).toBe(false);
  });
});

describe("classifyCardReconcile", () => {
  const c = card("🤖 正在处理…");
  const key = buildRenderedCardKey("legacy", true, c);

  it("内容与兜底态都未变 → noop", () => {
    expect(classifyCardReconcile(key, false, key, false)).toBe("noop");
    expect(classifyCardReconcile(key, true, key, true)).toBe("noop");
  });

  it("内容不变、仅兜底标记翻转 → fallback-only（不重挂载、不重置交互态）", () => {
    expect(classifyCardReconcile(key, false, key, true)).toBe("fallback-only");
    expect(classifyCardReconcile(key, true, key, false)).toBe("fallback-only");
  });

  it("内容指纹变化（真实新帧）→ remount（即便兜底态相同）", () => {
    const nextKey = buildRenderedCardKey("legacy", true, card("第 2 步"));
    expect(classifyCardReconcile(key, false, nextKey, false)).toBe("remount");
    expect(classifyCardReconcile(key, true, nextKey, true)).toBe("remount");
  });

  it("首次挂载（prevKey=null）→ remount", () => {
    expect(classifyCardReconcile(null, false, key, false)).toBe("remount");
  });

  it("内容与兜底同时变化 → 优先 remount（新帧语义覆盖兜底翻转）", () => {
    const nextKey = buildRenderedCardKey("legacy", true, card("第 2 步"));
    expect(classifyCardReconcile(key, false, nextKey, true)).toBe("remount");
  });
});
