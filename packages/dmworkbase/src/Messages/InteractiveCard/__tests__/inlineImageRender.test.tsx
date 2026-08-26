// @vitest-environment jsdom
//
// 端到端回归：模板内联的 data:image/svg+xml 折叠图标必须真正渲成 <img>。
// 曾经的故障是消毒层 https-only 把 Image.url 整键剥掉 —— 整卡不降级、文字照渲，
// 只有 chevron 静默消失、ToggleVisibility 点不到。故这里从 fixture 原文一路走到
// DOM 断言（validate → sanitize → SDK render），而不是只测消毒层返回值。

import { beforeAll, describe, expect, it } from "vitest";
import reasoningCard from "../fixtures/ai-reasoning-process-0.4.json";
import { renderOctoCard } from "../sdk/renderOctoCard";
import { validateCardForOcto } from "../validateCardForOcto";

beforeAll(() => {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
});

function mountTarget(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

function renderReasoningCard(): HTMLDivElement {
  const target = mountTarget();
  renderOctoCard({
    card: reasoningCard as unknown as Record<string, unknown>,
    target,
    onAction: () => {},
  });
  return target;
}

describe("ai.reasoning-process 卡片：内联 SVG 折叠图标", () => {
  it("整卡通过 octo 预校验（不降级为 plain）", () => {
    expect(
      validateCardForOcto(reasoningCard as unknown as Record<string, unknown>)
        .ok
    ).toBe(true);
  });

  it("四个 chevron 图标渲成 data:image/svg+xml 的 <img>", () => {
    const imgs = Array.from(
      renderReasoningCard().querySelectorAll<HTMLImageElement>("img")
    );
    // reasoning 折叠 2 个（collapsed/expanded）+ phase 0 工具折叠 2 个。
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      expect(img.getAttribute("src")).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    }
  });

  it("图标的 altText 与 ToggleVisibility 可点性保留", () => {
    const target = renderReasoningCard();
    const alts = Array.from(
      target.querySelectorAll<HTMLImageElement>("img")
    ).map((img) => img.getAttribute("alt"));
    expect(alts).toEqual(
      expect.arrayContaining(["展开", "收起", "展开工具", "收起工具"])
    );
    // selectAction 使图片成为可激活元素（SDK 给可点元素加 role/tabindex）。
    const clickable = target.querySelectorAll(
      'img[role="button"], [role="button"] img, img[tabindex]'
    );
    expect(clickable.length).toBeGreaterThan(0);
  });
});
