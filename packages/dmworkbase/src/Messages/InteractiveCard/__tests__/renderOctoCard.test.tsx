// @vitest-environment jsdom
//
// S4 renderOctoCard：官方 SDK 挂载封装。验证 markdown 钩子接线、octo/v2 子集渲染、
// OpenUrl 动作回调、重复挂载清空旧内容。

import { beforeAll, describe, expect, it } from "vitest";
import {
  enhanceRenderedOctoCard,
  renderOctoCard,
} from "../sdk/renderOctoCard";
import { extractTableCopyTexts } from "../sdk/tableCopy";

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
    {
      type: "Input.ChoiceSet",
      id: "size",
      choices: [{ title: "小", value: "s" }],
    },
  ],
  actions: [
    {
      type: "Action.OpenUrl",
      id: "open",
      title: "查看",
      url: "https://example.com",
    },
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

  it("Action.Submit 的 style positive/destructive → 渲染出 style-positive/style-destructive class（审批卡主/次按钮样式依赖此 SDK class 名）", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [{ type: "TextBlock", text: "审批" }],
        actions: [
          { type: "Action.Submit", id: "approve", title: "允许", style: "positive" },
          { type: "Action.Submit", id: "deny", title: "拒绝", style: "destructive" },
        ],
      },
      target,
      onAction: () => {},
    });
    // index.css 的 .ac-pushButton.style-positive / .style-destructive 依赖 SDK 为
    // style:positive/destructive 输出这两个 class；SDK 升级若改名，审批卡主/次按钮样式会
    // 静默失效——此测试兜底锁死该契约（对齐服务端 approval_request 模板打的 ActionStyle）。
    const classes = Array.from(
      target.querySelectorAll<HTMLButtonElement>(".ac-pushButton")
    ).map((b) => Array.from(b.classList));
    expect(classes.some((c) => c.includes("style-positive"))).toBe(true);
    expect(classes.some((c) => c.includes("style-destructive"))).toBe(true);
    target.remove();
  });

  it("Action.ToggleVisibility 由 SDK 原生切换 isVisible", () => {
    const target = mountTarget();
    const types: string[] = [];
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "Container",
            id: "details",
            isVisible: false,
            items: [{ type: "TextBlock", text: "隐藏详情" }],
          },
        ],
        actions: [
          {
            type: "Action.ToggleVisibility",
            title: "展开",
            targetElements: ["details"],
          },
        ],
      },
      target,
      onAction: (a) => types.push(a.getJsonTypeName()),
    });
    const details = target.querySelector<HTMLElement>("#details");
    expect(details?.style.display).toBe("none");
    target.querySelector("button")?.click();
    expect(types).toContain("Action.ToggleVisibility");
    expect(details?.style.display).not.toBe("none");
    target.remove();
  });

  it("Action.CopyToClipboard 渲染为按钮并向 host 透传 text", () => {
    const target = mountTarget();
    const seen: Array<{ type: string; text?: unknown }> = [];
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [{ type: "TextBlock", text: "复制测试" }],
        actions: [
          {
            type: "Action.CopyToClipboard",
            title: "复制",
            text: "SELECT 1",
          },
        ],
      },
      target,
      onAction: (a) =>
        seen.push({
          type: a.getJsonTypeName(),
          text: (a as unknown as { text?: unknown }).text,
        }),
    });
    target.querySelector("button")?.click();
    expect(seen).toEqual([
      { type: "Action.CopyToClipboard", text: "SELECT 1" },
    ]);
    target.remove();
  });

  it("Table 自动增强复制按钮，复制内容来自原始 JSON TSV", () => {
    const tableCard = {
      type: "AdaptiveCard",
      version: "1.5",
      body: [
        {
          type: "Table",
          columns: [{ width: 1 }, { width: 1 }],
          rows: [
            {
              type: "TableRow",
              cells: [
                {
                  type: "TableCell",
                  items: [{ type: "TextBlock", text: "项目" }],
                },
                {
                  type: "TableCell",
                  items: [{ type: "TextBlock", text: "结果" }],
                },
              ],
            },
            {
              type: "TableRow",
              cells: [
                {
                  type: "TableCell",
                  items: [{ type: "TextBlock", text: "响应" }],
                },
                {
                  type: "TableCell",
                  items: [
                    {
                      type: "RichTextBlock",
                      inlines: [
                        { type: "TextRun", text: "已" },
                        { type: "TextRun", text: "发", weight: "Bolder" },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(extractTableCopyTexts(tableCard)).toEqual([
      "项目\t结果\n响应\t已发",
    ]);

    const target = mountTarget();
    const copied: string[] = [];
    renderOctoCard({
      card: tableCard,
      target,
      onAction: () => {},
      tableCopyLabel: "复制",
      onTableCopy: (text) => copied.push(text),
    });

    const copyButton = target.querySelector<HTMLButtonElement>(
      ".wk-interactive-card-table-copy"
    );
    expect(copyButton?.textContent).toBe("复制");
    expect(
      target.querySelector(".wk-interactive-card-table-frame")
    ).not.toBeNull();
    const firstCell = target.querySelector<HTMLElement>(
      ".wk-interactive-card-table-frame [role='columnheader']"
    );
    expect(firstCell?.style.getPropertyValue("padding")).toBe(
      "var(--wk-sp-2, 8px) var(--wk-sp-5, 20px)"
    );
    copyButton?.click();
    expect(copied).toEqual(["项目\t结果\n响应\t已发"]);

    firstCell?.style.setProperty("padding", "0px");
    enhanceRenderedOctoCard({
      card: tableCard,
      target,
      onAction: () => {},
      tableCopyLabel: "复制",
      onTableCopy: (text) => copied.push(text),
    });
    expect(firstCell?.style.getPropertyValue("padding")).toBe(
      "var(--wk-sp-2, 8px) var(--wk-sp-5, 20px)"
    );
    expect(
      target.querySelectorAll(".wk-interactive-card-table-header").length
    ).toBe(1);
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
    expect(
      imgs.some((i) => (i.getAttribute("src") || "").startsWith("http://"))
    ).toBe(false);
    expect(
      imgs.some((i) => (i.getAttribute("src") || "").startsWith("https://"))
    ).toBe(true);
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

  it("普通卡即使含 timeline_detail 也不会触发 agent progress 后处理", () => {
    const target = mountTarget();
    renderOctoCard({
      card: {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          {
            type: "Container",
            id: "timeline_detail",
            style: "attention",
            items: [{ type: "TextBlock", text: "普通卡状态块" }],
          },
        ],
      },
      target,
      onAction: () => {},
    });

    expect(
      target.querySelector(".wk-interactive-card-progress-step")
    ).toBeNull();
    expect(
      target.querySelector(".wk-interactive-card-progress-step--status")
    ).toBeNull();
    target.remove();
  });
});
