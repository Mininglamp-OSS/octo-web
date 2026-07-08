// @vitest-environment jsdom
//
// ACRenderer 测试：5 元素渲染、Action.OpenUrl/selectAction、图片混合内容占位、
// 以及「未知元素/动作/结构损坏/深宽越界 → 抛 CardRenderError 整卡 fallback」契约。

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { renderCard, CardRenderError } from "../renderer/ACRenderer";
import { RenderBudget } from "../guards";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function render(card: Record<string, unknown>): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(renderCard(card, new RenderBudget()), container!);
  });
  return container;
}

const AC = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "AdaptiveCard",
  body,
  ...extra,
});

describe("ACRenderer — 5 元素渲染", () => {
  it("TextBlock 渲染 markdown 文本", () => {
    const root = render(AC([{ type: "TextBlock", text: "**粗**普通" }]));
    expect(root.querySelector(".wk-interactive-card-textblock")).not.toBeNull();
    expect(root.querySelector("strong")?.textContent).toBe("粗");
  });

  it("Image(https) 渲染 <img>", () => {
    const root = render(
      AC([{ type: "Image", url: "https://cdn.example.com/a.png", altText: "图" }])
    );
    const img = root.querySelector("img.wk-interactive-card-img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/a.png");
  });

  it("Image(http) 混合内容 → 占位，不产出 <img>", () => {
    const root = render(
      AC([{ type: "Image", url: "http://cdn.example.com/a.png", altText: "备用图" }])
    );
    expect(root.querySelector("img")).toBeNull();
    const ph = root.querySelector(".wk-interactive-card-img-placeholder");
    expect(ph).not.toBeNull();
    expect(ph?.textContent).toBe("备用图");
  });

  it("Container 递归渲染 items", () => {
    const root = render(
      AC([
        {
          type: "Container",
          items: [{ type: "TextBlock", text: "内层" }],
        },
      ])
    );
    expect(root.querySelector(".wk-interactive-card-container")).not.toBeNull();
    expect(root.textContent).toContain("内层");
  });

  it("ColumnSet/Column 布局递归", () => {
    const root = render(
      AC([
        {
          type: "ColumnSet",
          columns: [
            { type: "Column", items: [{ type: "TextBlock", text: "左" }] },
            { type: "Column", items: [{ type: "TextBlock", text: "右" }] },
          ],
        },
      ])
    );
    expect(root.querySelectorAll(".wk-interactive-card-column").length).toBe(2);
    expect(root.textContent).toContain("左");
    expect(root.textContent).toContain("右");
  });

  it("FactSet 渲染 title/value（markdown）", () => {
    const root = render(
      AC([
        {
          type: "FactSet",
          facts: [
            { title: "状态", value: "**已发货**" },
            { title: "单号", value: "12345" },
          ],
        },
      ])
    );
    expect(root.querySelectorAll(".wk-interactive-card-fact").length).toBe(2);
    expect(root.querySelector("strong")?.textContent).toBe("已发货");
  });
});

describe("ACRenderer — Action.OpenUrl / selectAction", () => {
  it("根 actions 渲染 Action.OpenUrl 按钮", () => {
    const root = render(
      AC([{ type: "TextBlock", text: "x" }], {
        actions: [
          { type: "Action.OpenUrl", title: "查看", url: "https://example.com" },
        ],
      })
    );
    const btn = root.querySelector("button.wk-interactive-card-action");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain("查看");
  });

  it("selectAction 携带 OpenUrl → 元素可点", () => {
    const root = render(
      AC([
        {
          type: "Container",
          items: [{ type: "TextBlock", text: "可点" }],
          selectAction: {
            type: "Action.OpenUrl",
            title: "",
            url: "https://example.com",
          },
        },
      ])
    );
    expect(root.querySelector(".wk-interactive-card-clickable")).not.toBeNull();
  });

  it("嵌套点击不冒泡：内层 action 按钮点击只打开一次（stopPropagation）", () => {
    const root = render(
      AC([{ type: "TextBlock", text: "x" }], {
        selectAction: {
          type: "Action.OpenUrl",
          title: "",
          url: "https://outer.example.com",
        },
        actions: [
          {
            type: "Action.OpenUrl",
            title: "内层",
            url: "https://inner.example.com",
          },
        ],
      })
    );
    const opened: string[] = [];
    const origOpen = window.open;
    (window as any).open = (u: string) => {
      opened.push(u);
      return null;
    };
    try {
      const btn = root.querySelector(
        "button.wk-interactive-card-action"
      ) as HTMLButtonElement;
      act(() => {
        btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    } finally {
      window.open = origOpen;
    }
    // 只打开内层 url 一次，外层 selectAction 未被冒泡触发。
    expect(opened).toEqual(["https://inner.example.com"]);
  });
});

describe("ACRenderer — 整卡 fallback（抛 CardRenderError）", () => {
  const budget = () => new RenderBudget();

  it("非 AdaptiveCard 根 → 抛错", () => {
    expect(() => renderCard({ type: "Nope" }, budget())).toThrow(
      CardRenderError
    );
  });

  it("未知元素类型 → 抛错", () => {
    expect(() =>
      renderCard(AC([{ type: "Media" }]), budget())
    ).toThrow(CardRenderError);
  });

  it("未知动作类型（Action.Submit）→ 抛错", () => {
    expect(() =>
      renderCard(AC([{ type: "TextBlock", text: "x" }], {
        actions: [{ type: "Action.Submit", title: "提交" }],
      }), budget())
    ).toThrow(CardRenderError);
  });

  it("Input.* 作为元素 → 抛错（波 1 禁交互）", () => {
    expect(() =>
      renderCard(AC([{ type: "Input.Text", id: "x" }]), budget())
    ).toThrow(CardRenderError);
  });

  it("selectAction 非 OpenUrl（Submit）→ 抛错", () => {
    expect(() =>
      renderCard(
        AC([
          {
            type: "Container",
            items: [],
            selectAction: { type: "Action.Submit" },
          },
        ]),
        budget()
      )
    ).toThrow(CardRenderError);
  });

  it("Action.OpenUrl 携带非法 url（javascript:）→ 抛错", () => {
    expect(() =>
      renderCard(
        AC([{ type: "TextBlock", text: "x" }], {
          actions: [
            { type: "Action.OpenUrl", title: "x", url: "javascript:alert(1)" },
          ],
        }),
        budget()
      )
    ).toThrow(CardRenderError);
  });

  it("Column 内混入非 Column → 抛错", () => {
    expect(() =>
      renderCard(
        AC([{ type: "ColumnSet", columns: [{ type: "TextBlock", text: "x" }] }]),
        budget()
      )
    ).toThrow(CardRenderError);
  });

  it("元素结构损坏（无 type）→ 抛错", () => {
    expect(() => renderCard(AC([{ text: "no type" }]), budget())).toThrow(
      CardRenderError
    );
  });
});

describe("ACRenderer — 深/宽越界防御", () => {
  it("节点数越界 → 抛错（不卡 UI）", () => {
    const many = Array.from({ length: 5 }, () => ({
      type: "TextBlock",
      text: "x",
    }));
    // budget 上限设为 3，5 个节点必越界
    expect(() =>
      renderCard(AC(many), new RenderBudget(3, 16))
    ).toThrow(CardRenderError);
  });

  it("深度越界 → 抛错（不栈溢出）", () => {
    // 构造 depth=4 的嵌套 Container，budget maxDepth=2
    let node: Record<string, unknown> = { type: "TextBlock", text: "deep" };
    for (let i = 0; i < 4; i++) {
      node = { type: "Container", items: [node] };
    }
    expect(() =>
      renderCard(AC([node]), new RenderBudget(200, 2))
    ).toThrow(CardRenderError);
  });

  it("FactSet.facts 计入节点预算 → 超大 facts 越界抛错（fail-closed，不狂渲 DOM）", () => {
    const facts = Array.from({ length: 5 }, (_, i) => ({
      title: `k${i}`,
      value: `v${i}`,
    }));
    // budget 上限 3：FactSet 元素本身 1 + 5 facts 必越界
    expect(() =>
      renderCard(AC([{ type: "FactSet", facts }]), new RenderBudget(3, 16))
    ).toThrow(CardRenderError);
  });

  it("actions 计入节点预算 → 超大 actions 越界抛错", () => {
    const actions = Array.from({ length: 5 }, (_, i) => ({
      type: "Action.OpenUrl",
      title: `a${i}`,
      url: "https://example.com",
    }));
    expect(() =>
      renderCard(
        AC([{ type: "TextBlock", text: "x" }], { actions }),
        new RenderBudget(3, 16)
      )
    ).toThrow(CardRenderError);
  });

  it("每个 Column 计入节点预算 → 超多 columns 越界抛错", () => {
    const columns = Array.from({ length: 5 }, () => ({ items: [] }));
    // ColumnSet 元素 1 + 每列各 1，budget 3 必越界
    expect(() =>
      renderCard(
        AC([{ type: "ColumnSet", columns }]),
        new RenderBudget(3, 16)
      )
    ).toThrow(CardRenderError);
  });

  it("selectAction 计入节点预算 → 恰好被 selectAction 顶破上限时抛错", () => {
    const containerWith = (withSelect: boolean) =>
      AC([
        {
          type: "Container",
          items: [
            { type: "TextBlock", text: "a" },
            { type: "TextBlock", text: "b" },
          ],
          ...(withSelect
            ? {
                selectAction: {
                  type: "Action.OpenUrl",
                  title: "",
                  url: "https://example.com",
                },
              }
            : {}),
        },
      ]);
    // 无 selectAction：Container 1 + 2 TextBlock = 3，恰好不越界
    expect(() =>
      renderCard(containerWith(false), new RenderBudget(3, 16))
    ).not.toThrow();
    // 有 selectAction：多出 1 个 action 节点 → 越界抛错
    expect(() =>
      renderCard(containerWith(true), new RenderBudget(3, 16))
    ).toThrow(CardRenderError);
  });
});

describe("ACRenderer — Column type 可省略（对齐服务端 validate）", () => {
  it("columns[*] 省略 type → 视为 Column，正常渲染两列（不整卡 fallback）", () => {
    const root = render(
      AC([
        {
          type: "ColumnSet",
          columns: [
            { items: [{ type: "TextBlock", text: "左" }] },
            { items: [{ type: "TextBlock", text: "右" }] },
          ],
        },
      ])
    );
    expect(root.querySelectorAll(".wk-interactive-card-column").length).toBe(2);
    expect(root.textContent).toContain("左");
    expect(root.textContent).toContain("右");
  });

  it("columns[*] 显式非 Column type → 仍整卡 fallback（抛错）", () => {
    expect(() =>
      renderCard(
        AC([
          {
            type: "ColumnSet",
            columns: [{ type: "TextBlock", text: "x" }],
          },
        ]),
        new RenderBudget()
      )
    ).toThrow(CardRenderError);
  });
});

describe("ACRenderer — Action.OpenUrl.iconUrl 混合内容（https-only）", () => {
  it("iconUrl https → 渲染 <img> 图标", () => {
    const root = render(
      AC([{ type: "TextBlock", text: "x" }], {
        actions: [
          {
            type: "Action.OpenUrl",
            title: "看",
            url: "https://example.com",
            iconUrl: "https://cdn.example.com/i.png",
          },
        ],
      })
    );
    expect(
      root.querySelector("img.wk-interactive-card-action-icon")
    ).not.toBeNull();
  });

  it("iconUrl http → 不渲染图标（混合内容），按钮仍在", () => {
    const root = render(
      AC([{ type: "TextBlock", text: "x" }], {
        actions: [
          {
            type: "Action.OpenUrl",
            title: "看",
            url: "https://example.com",
            iconUrl: "http://cdn.example.com/i.png",
          },
        ],
      })
    );
    expect(root.querySelector("img.wk-interactive-card-action-icon")).toBeNull();
    expect(
      root.querySelector("button.wk-interactive-card-action")?.textContent
    ).toContain("看");
  });
});

describe("ACRenderer — 结构损坏字段整卡 fallback（present-but-非数组）", () => {
  const budget = () => new RenderBudget();

  it("body 非数组 → 抛错（不 fail-open 成空卡）", () => {
    expect(() =>
      renderCard({ type: "AdaptiveCard", body: "bad" }, budget())
    ).toThrow(CardRenderError);
  });

  it("Container.items 非数组 → 抛错", () => {
    expect(() =>
      renderCard(AC([{ type: "Container", items: "bad" }]), budget())
    ).toThrow(CardRenderError);
  });

  it("ColumnSet.columns 非数组 → 抛错", () => {
    expect(() =>
      renderCard(AC([{ type: "ColumnSet", columns: "bad" }]), budget())
    ).toThrow(CardRenderError);
  });

  it("actions 非数组（对象）→ 抛错", () => {
    expect(() =>
      renderCard(
        AC([{ type: "TextBlock", text: "x" }], { actions: { foo: 1 } }),
        budget()
      )
    ).toThrow(CardRenderError);
  });

  it("FactSet.facts 非数组 → 抛错", () => {
    expect(() =>
      renderCard(AC([{ type: "FactSet", facts: "bad" }]), budget())
    ).toThrow(CardRenderError);
  });

  it("缺省（undefined）字段仍合法 → 空卡正常渲染，不抛错", () => {
    expect(() =>
      renderCard({ type: "AdaptiveCard" }, budget())
    ).not.toThrow();
  });
});

describe("ACRenderer — Image.selectAction（对齐服务端允许）", () => {
  it("Image 携带 OpenUrl selectAction → 图片可点（包裹 clickable）", () => {
    const root = render(
      AC([
        {
          type: "Image",
          url: "https://cdn.example.com/a.png",
          selectAction: {
            type: "Action.OpenUrl",
            title: "",
            url: "https://example.com",
          },
        },
      ])
    );
    expect(root.querySelector(".wk-interactive-card-clickable")).not.toBeNull();
    expect(root.querySelector("img.wk-interactive-card-img")).not.toBeNull();
  });

  it("Image.selectAction 计入节点预算 → 顶破上限时抛错", () => {
    const imgWith = (withSelect: boolean) =>
      AC([
        {
          type: "Image",
          url: "https://cdn.example.com/a.png",
          ...(withSelect
            ? {
                selectAction: {
                  type: "Action.OpenUrl",
                  title: "",
                  url: "https://example.com",
                },
              }
            : {}),
        },
      ]);
    // 无 selectAction：Image 元素 1 个节点，budget 1 恰好不越界
    expect(() =>
      renderCard(imgWith(false), new RenderBudget(1, 16))
    ).not.toThrow();
    // 有 selectAction：多 1 个 action 节点 → 越界抛错
    expect(() =>
      renderCard(imgWith(true), new RenderBudget(1, 16))
    ).toThrow(CardRenderError);
  });

  it("Image.selectAction 为非 OpenUrl（Submit）→ 整卡 fallback（抛错）", () => {
    expect(() =>
      renderCard(
        AC([
          {
            type: "Image",
            url: "https://cdn.example.com/a.png",
            selectAction: { type: "Action.Submit" },
          },
        ]),
        new RenderBudget()
      )
    ).toThrow(CardRenderError);
  });
});
