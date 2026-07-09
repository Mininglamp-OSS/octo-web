// @vitest-environment jsdom
//
// config→render 集成测试：验证 buildOctoHostConfig 产出的 containerStyles 背景填色
// 真正被官方 SDK 落到 DOM（AC 3.0.6 applyBackground 写为 .ac-container 的 inline
// background-color）。补足 octoSdkConfig.test.ts 的 config-object 层断言之外、
// 「填色是否真的渲染出来」的盲区（review #590 建议）。
//
// 用注入 stub resolver 提供确定色值——jsdom 不解析 var(--wk-*)，故不能用
// browserCssVarResolver；这与 octoSdkConfig.test.ts 的做法一致。

import { beforeAll, describe, expect, it } from "vitest";
import { AdaptiveCard } from "adaptivecards";
import { buildOctoHostConfig } from "../sdk/octoHostConfig";

beforeAll(() => {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  AdaptiveCard.onProcessMarkdown = (text, result) => {
    result.outputHtml = text;
    result.didProcess = true;
  };
});

const STUB: Record<string, string> = {
  "var(--wk-text-primary)": "rgb(10, 10, 10)",
  "var(--wk-text-secondary)": "rgb(120, 120, 120)",
  "var(--wk-text-accent)": "rgb(30, 100, 255)",
  "var(--wk-bg-surface)": "rgb(255, 255, 255)",
  "var(--wk-bg-elevated)": "rgb(245, 245, 245)",
  "var(--wk-accent-tint-10)": "rgb(230, 240, 255)",
  "var(--wk-color-success)": "rgb(0, 150, 0)",
  "var(--wk-color-success-bg)": "rgb(230, 250, 230)",
  "var(--wk-color-warning)": "rgb(200, 150, 0)",
  "var(--wk-color-warning-bg)": "rgb(255, 250, 230)",
  "var(--wk-color-danger)": "rgb(200, 0, 0)",
  "var(--wk-color-danger-bg)": "rgb(255, 235, 235)",
};

// 按 body 顺序：每个 Container.style → 期望渲染出的 inline background-color。
const CASES: Array<{ style: string; bg: string }> = [
  { style: "emphasis", bg: "rgb(245, 245, 245)" },
  { style: "accent", bg: "rgb(230, 240, 255)" },
  { style: "good", bg: "rgb(230, 250, 230)" },
  { style: "warning", bg: "rgb(255, 250, 230)" },
  { style: "attention", bg: "rgb(255, 235, 235)" },
];

describe("Container.style 填色渲染到 DOM（config→render）", () => {
  it("五种 containerStyle 各自的背景色被渲染为 .ac-container 的 inline background-color", () => {
    const card = new AdaptiveCard();
    card.hostConfig = buildOctoHostConfig((expr) => STUB[expr] ?? expr);
    card.parse({
      type: "AdaptiveCard",
      version: "1.5",
      body: CASES.map((c) => ({
        type: "Container",
        style: c.style,
        items: [{ type: "TextBlock", text: c.style }],
      })),
    });

    const el = card.render();
    expect(el).not.toBeNull();

    const containers = el!.querySelectorAll<HTMLElement>(".ac-container");
    expect(containers.length).toBe(CASES.length);
    CASES.forEach((c, i) => {
      expect(containers[i].style.backgroundColor).toBe(c.bg);
    });
  });
});
