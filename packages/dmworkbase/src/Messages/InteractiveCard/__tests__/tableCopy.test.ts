// @vitest-environment jsdom
//
// tableCopy 抽取契约（回归测试）：
//   1. 索引与 collectTables 严格对齐（不做 .filter(Boolean)，空表返回占位）；
//   2. isVisible === false 全程尊重（Table / row / cell / cell 内元素）。
// 这两条同 PR 引入 ToggleVisibility + 表格复制，interact 出「显示 ≠ 复制」的数据完整性问题，
// 见 review #599（yujiawei / Jerry-Xin / OctoBoooot 三方收敛）。

import { describe, it, expect } from "vitest";

import {
  attachTableCopyButtons,
  extractTableCopyTexts,
} from "../sdk/tableCopy";

const table = (opts: {
  rows: Array<Array<string | Record<string, unknown>>>;
  isVisible?: boolean;
}) => {
  const cell = (content: string | Record<string, unknown>) =>
    typeof content === "string"
      ? {
          type: "TableCell",
          items: [{ type: "TextBlock", text: content }],
        }
      : content;
  return {
    type: "Table",
    columns: opts.rows[0]?.map(() => ({})) ?? [],
    rows: opts.rows.map((row) => ({
      type: "TableRow",
      cells: row.map(cell),
    })),
    ...(opts.isVisible === false ? { isVisible: false } : {}),
  };
};

const wrapAdaptiveCard = (body: unknown[]) => ({
  type: "AdaptiveCard",
  body,
});

describe("extractTableCopyTexts — 索引与 collectTables 严格对齐（Blocker 1 回归）", () => {
  it("首表全空 + 次表有文本：不 collapse 索引，保持 ['', text] 而非 [text]", () => {
    // 原实现末尾 .filter(Boolean) 会把空表丢弃，导致 attachTableCopyButtons
    // 把「首表按钮」错绑到「次表文本」——静默复制串表内容。
    const emptyImageTable = table({
      rows: [
        [
          { type: "TableCell", items: [{ type: "Image", url: "/a.png" }] },
          { type: "TableCell", items: [{ type: "Image", url: "/b.png" }] },
        ],
      ],
    });
    const textTable = table({ rows: [["SECRET-A1", "SECRET-B1"]] });

    const texts = extractTableCopyTexts(
      wrapAdaptiveCard([emptyImageTable, textTable])
    );
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(""); // 空表占位，不能被吃掉
    expect(texts[1]).toBe("SECRET-A1\tSECRET-B1"); // 次表原样落到自己的槽位
  });

  it("空表数组仍返回空数组（无 Table 时无副作用）", () => {
    expect(extractTableCopyTexts(wrapAdaptiveCard([]))).toEqual([]);
  });
});

describe("attachTableCopyButtons — 按钮不串表内容（Blocker 1 端到端）", () => {
  it("首表空、次表有文本时，按钮只挂到次表且复制次表自己的文本", () => {
    document.body.innerHTML = "";
    const target = document.createElement("div");
    document.body.appendChild(target);

    // 构造 HTML table 路径（renderer 输出通常是 <table>），两张形状一致的表。
    // 首表所有单元格 textContent 为空，次表有真实文本。
    const t1 = document.createElement("table");
    t1.innerHTML = "<tbody><tr><td></td><td></td></tr></tbody>";
    const t2 = document.createElement("table");
    t2.innerHTML =
      "<tbody><tr><td>SECRET-A1</td><td>SECRET-B1</td></tr></tbody>";
    target.append(t1, t2);

    const card = wrapAdaptiveCard([
      table({
        rows: [
          [
            { type: "TableCell", items: [{ type: "Image", url: "/a.png" }] },
            { type: "TableCell", items: [{ type: "Image", url: "/b.png" }] },
          ],
        ],
      }),
      table({ rows: [["SECRET-A1", "SECRET-B1"]] }),
    ]);

    const copied: string[] = [];
    attachTableCopyButtons({
      card,
      target,
      label: "复制",
      onCopy: (text) => copied.push(text),
    });

    const buttons = Array.from(
      target.querySelectorAll<HTMLButtonElement>(
        ".wk-interactive-card-table-copy"
      )
    );
    // 只应挂一颗按钮（首表空 → 跳过；次表挂一颗），旧实现会挂到首表且复制次表文本。
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    expect(copied).toEqual(["SECRET-A1\tSECRET-B1"]);

    // 明确检查：按钮必须在次表所在 frame 内，而不是首表。
    const frame = buttons[0].closest(".wk-interactive-card-table-frame");
    expect(frame?.contains(t2)).toBe(true);
    expect(frame?.contains(t1)).toBe(false);

    target.remove();
  });
});

describe("extractTableCopyTexts — isVisible 感知（Blocker 2 回归）", () => {
  it("cell 内 isVisible:false 元素不进入复制文本", () => {
    // ToggleVisibility 场景：单元格里既有显示的公开文本，也有隐藏的机密文本。
    // 旧实现无视 isVisible，机密会被静默写入剪贴板；显示 ≠ 复制。
    const card = wrapAdaptiveCard([
      table({
        rows: [
          [
            {
              type: "TableCell",
              items: [
                { type: "TextBlock", text: "VISIBLE-public" },
                {
                  type: "TextBlock",
                  text: "HIDDEN-secret",
                  isVisible: false,
                },
              ],
            },
          ],
        ],
      }),
    ]);
    const texts = extractTableCopyTexts(card);
    expect(texts).toEqual(["VISIBLE-public"]);
    expect(texts[0]).not.toContain("HIDDEN-secret");
  });

  it("整行 isVisible:false 不进入 TSV（保留其他显示行）", () => {
    const card = wrapAdaptiveCard([
      {
        type: "Table",
        columns: [{}, {}],
        rows: [
          {
            type: "TableRow",
            cells: [
              { type: "TableCell", items: [{ type: "TextBlock", text: "V1" }] },
              { type: "TableCell", items: [{ type: "TextBlock", text: "V2" }] },
            ],
          },
          {
            type: "TableRow",
            isVisible: false, // 整行隐藏
            cells: [
              {
                type: "TableCell",
                items: [
                  { type: "TextBlock", text: "HIDDEN-ROW-secret-A" },
                ],
              },
              {
                type: "TableCell",
                items: [
                  { type: "TextBlock", text: "HIDDEN-ROW-secret-B" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const texts = extractTableCopyTexts(card);
    expect(texts).toEqual(["V1\tV2"]);
    expect(texts[0]).not.toContain("HIDDEN-ROW-secret");
  });

  it("单个 cell isVisible:false 不进入 TSV，其他 cell 保留", () => {
    const card = wrapAdaptiveCard([
      {
        type: "Table",
        columns: [{}, {}],
        rows: [
          {
            type: "TableRow",
            cells: [
              {
                type: "TableCell",
                items: [{ type: "TextBlock", text: "keep" }],
              },
              {
                type: "TableCell",
                isVisible: false,
                items: [{ type: "TextBlock", text: "HIDDEN-CELL" }],
              },
            ],
          },
        ],
      },
    ]);
    const texts = extractTableCopyTexts(card);
    expect(texts).toEqual(["keep"]);
    expect(texts[0]).not.toContain("HIDDEN-CELL");
  });

  it("整张 Table isVisible:false → 返回空字符串占位（保持索引对齐）", () => {
    // 索引契约（Blocker 1）+ 可见性契约（Blocker 2）交叉：
    // 隐藏表不能被静默复制，但其在结果数组中的槽位必须保留，避免让后续表按钮错位。
    const card = wrapAdaptiveCard([
      table({ isVisible: false, rows: [["HIDDEN-TABLE-secret"]] }),
      table({ rows: [["VISIBLE-tail"]] }),
    ]);
    const texts = extractTableCopyTexts(card);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe("");
    expect(texts[1]).toBe("VISIBLE-tail");
  });

  it("RichTextBlock inline isVisible:false 不进入文本", () => {
    const card = wrapAdaptiveCard([
      table({
        rows: [
          [
            {
              type: "TableCell",
              items: [
                {
                  type: "RichTextBlock",
                  inlines: [
                    { type: "TextRun", text: "keep" },
                    {
                      type: "TextRun",
                      text: "HIDDEN-INLINE",
                      isVisible: false,
                    },
                  ],
                },
              ],
            },
          ],
        ],
      }),
    ]);
    const texts = extractTableCopyTexts(card);
    expect(texts[0]).toBe("keep");
    expect(texts[0]).not.toContain("HIDDEN-INLINE");
  });
});
