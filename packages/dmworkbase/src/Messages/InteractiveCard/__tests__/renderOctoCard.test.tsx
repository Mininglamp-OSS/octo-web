// @vitest-environment jsdom
//
// S4 renderOctoCard：官方 SDK 挂载封装。验证 markdown 钩子接线、octo/v2 子集渲染、
// OpenUrl 动作回调、重复挂载清空旧内容。

import { beforeAll, describe, expect, it } from "vitest";
import { renderOctoCard } from "../sdk/renderOctoCard";

beforeAll(() => {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
});

const V2 = {
  type: "AdaptiveCard",
  version: "1.5",
  body: [
    { type: "TextBlock", text: "**订单**说明" },
    { type: "Input.Text", id: "note", placeholder: "备注" },
    { type: "Input.ChoiceSet", id: "size", choices: [{ title: "小", value: "s" }] },
  ],
  actions: [
    { type: "Action.OpenUrl", id: "open", title: "查看", url: "https://example.com" },
    { type: "Action.Submit", id: "ok", title: "提交" },
  ],
};

function mountTarget(): HTMLDivElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

describe("renderOctoCard", () => {
  it("渲染 octo/v2 子集：markdown 正文 + input/select + 按钮", () => {
    const target = mountTarget();
    renderOctoCard({ card: V2, target, onAction: () => {} });
    // markdown 钩子生效：TextBlock 正文非空（Spike F1）。
    expect(target.textContent).toContain("订单");
    expect(target.querySelector("input, textarea")).not.toBeNull();
    expect(target.querySelector("select")).not.toBeNull();
    expect(target.querySelectorAll("button").length).toBeGreaterThanOrEqual(2);
    target.remove();
  });

  it("渲染 RichTextBlock/TextRun（服务端 manifest 展示元素）", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "RichTextBlock",
            inlines: [
              { type: "TextRun", text: "📖 " },
              { type: "TextRun", text: "读取文件", weight: "Bolder" },
              { type: "TextRun", text: "：/work/README.md" },
              { type: "TextRun", text: " · 180ms", color: "good" },
            ],
          },
        ],
      },
      target,
      onAction: () => {},
    });
    const runs = Array.from(target.querySelectorAll(".ac-textRun"));
    const renderedText = runs
      .map((run) => (run as HTMLElement).innerText || run.textContent || "")
      .join("");
    expect(renderedText).toContain("读取文件");
    expect(renderedText).toContain("/work/README.md");
    expect(
      runs.some((run) => (run as HTMLElement).style.fontWeight === "600")
    ).toBe(true);
    target.remove();
  });

  it("按钮点击 → onAction 收到对应动作（OpenUrl / Submit 均经回调）", () => {
    const target = mountTarget();
    const types: string[] = [];
    renderOctoCard({
      card: V2,
      target,
      onAction: (a) => types.push(a.getJsonTypeName()),
    });
    const buttons = Array.from(target.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    buttons.forEach((b) => b.click());
    // 所有动作都经 onAction 路由（host 负责 OpenUrl 导航 / Submit 提交）。
    expect(types).toContain("Action.OpenUrl");
    expect(types).toContain("Action.Submit");
    target.remove();
  });

  it("重复挂载清空旧内容（不残留）", () => {
    const target = mountTarget();
    renderOctoCard({ card: V2, target, onAction: () => {} });
    const firstCount = target.querySelectorAll("button").length;
    renderOctoCard({ card: V2, target, onAction: () => {} });
    // 清空后重挂载：按钮数量不翻倍。
    expect(target.querySelectorAll("button").length).toBe(firstCount);
    target.remove();
  });

  it("http 图片经消毒不产出 http <img>（喂 SDK 前 https-only 生效）", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          { type: "Image", url: "http://evil/track.png", altText: "x" },
          { type: "Image", url: "https://cdn/ok.png", altText: "y" },
        ],
      },
      target,
      onAction: () => {},
    });
    const imgs = Array.from(target.querySelectorAll("img"));
    // 不应出现任何 http src；https 图仍在。
    expect(imgs.some((i) => (i.getAttribute("src") || "").startsWith("http://"))).toBe(false);
    expect(imgs.some((i) => (i.getAttribute("src") || "").startsWith("https://"))).toBe(true);
    target.remove();
  });

  it("P3-3 富输入 Input.Number/Date/Time 渲染出对应原生控件", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          { type: "Input.Number", id: "n" },
          { type: "Input.Date", id: "d" },
          { type: "Input.Time", id: "tm" },
        ],
      },
      target,
      onAction: () => {},
    });
    expect(target.querySelector("input[type=number]")).not.toBeNull();
    expect(target.querySelector("input[type=date]")).not.toBeNull();
    expect(target.querySelector("input[type=time]")).not.toBeNull();
    target.remove();
  });

  it("requires+fallback 子树不被渲染（fallback/requires 已剥，防未校验子树逃逸）", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: "主内容",
            // 未满足的 requires → SDK 本会渲染 fallback 的 <input>；剥除后不应出现。
            requires: { cap: "1" },
            fallback: { type: "Input.Text", id: "sneaky" },
          },
        ],
      },
      target,
      onAction: () => {},
    });
    expect(target.textContent).toContain("主内容");
    expect(target.querySelector("input")).toBeNull(); // fallback 未逃逸
    target.remove();
  });
});
