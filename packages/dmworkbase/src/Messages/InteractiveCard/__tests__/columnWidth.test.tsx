// @vitest-environment jsdom
//
// SDK 契约金丝雀：Column.width 数字权重 → flex-basis 百分比。
// 排查「卡片三列比例失效」时实证：AC 3.0.6 把 width:3/1/1 渲染为 flex 1 1 60%/20%/20%，
// 权重本就生效；此前的「等宽」错觉源于 Container.style 填色缺失、列边界不可见。
// 锁定此行为，防止 SDK 升级后数字权重支持漂移。

import { beforeAll, describe, expect, it } from "vitest";
import { AdaptiveCard, HostConfig } from "adaptivecards";

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

function renderColumnWidths(widths: Array<number | string>): string[] {
  const card = new AdaptiveCard();
  card.hostConfig = new HostConfig({});
  card.parse({
    type: "AdaptiveCard",
    version: "1.5",
    body: [
      {
        type: "ColumnSet",
        columns: widths.map((width) => ({
          type: "Column",
          width,
          items: [{ type: "TextBlock", text: String(width) }],
        })),
      },
    ],
  });
  const el = card.render();
  if (!el) throw new Error("card did not render");
  const columns = Array.from(
    el.querySelectorAll<HTMLElement>(".ac-columnSet > .ac-container")
  );
  return columns.map((c) => c.style.flexBasis);
}

describe("Column.width 数字权重契约", () => {
  it("width 3/1/1 渲染为 60%/20%/20% 的 flex-basis", () => {
    expect(renderColumnWidths([3, 1, 1])).toEqual(["60%", "20%", "20%"]);
  });

  it("width 1/1/1 渲染为等宽 33.333%", () => {
    const bases = renderColumnWidths([1, 1, 1]);
    for (const b of bases) {
      expect(b.startsWith("33.33")).toBe(true);
    }
  });
});
