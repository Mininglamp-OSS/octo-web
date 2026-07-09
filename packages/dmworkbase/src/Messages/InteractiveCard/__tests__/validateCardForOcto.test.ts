// validateCardForOcto：octo 预校验（整卡降级判定）。覆盖白名单/结构/URL/预算/D1 的降级契约，
// 外加 octo/v2 交互元素与真实预算上限（MAX_NODES=200 / MAX_DEPTH=16）。

import { describe, expect, it } from "vitest";
import { validateCardForOcto } from "../validateCardForOcto";

const AC = (body: unknown[], extra: Record<string, unknown> = {}) => ({
  type: "AdaptiveCard",
  body,
  ...extra,
});
const V2 = { allowInteractive: true } as const;

describe("validateCardForOcto — 合法（ok:true）", () => {
  it("合法 v1 卡（TextBlock）", () => {
    expect(validateCardForOcto(AC([{ type: "TextBlock", text: "x" }])).ok).toBe(true);
  });
  it("空卡（无 body）", () => {
    expect(validateCardForOcto({ type: "AdaptiveCard" }).ok).toBe(true);
  });
  it("Container/ColumnSet/FactSet + Column 省略 type", () => {
    expect(
      validateCardForOcto(
        AC([
          { type: "Container", items: [{ type: "TextBlock", text: "a" }] },
          {
            type: "ColumnSet",
            columns: [{ items: [{ type: "TextBlock", text: "l" }] }],
          },
          { type: "FactSet", facts: [{ title: "k", value: "v" }] },
        ])
      ).ok
    ).toBe(true);
  });
  it("RichTextBlock/TextRun（服务端 manifest 展示元素）", () => {
    expect(
      validateCardForOcto(
        AC([
          {
            type: "RichTextBlock",
            inlines: [
              { type: "TextRun", text: "读取文件", weight: "Bolder" },
              { type: "TextRun", text: " · 180ms", color: "good" },
            ],
          },
        ])
      ).ok
    ).toBe(true);
  });
  it("ImageSet / ActionSet / Table（服务端 manifest 展示元素）", () => {
    expect(
      validateCardForOcto(
        AC([
          {
            type: "ImageSet",
            images: [{ type: "Image", url: "https://cdn/a.png" }],
          },
          {
            type: "ActionSet",
            actions: [
              {
                type: "Action.OpenUrl",
                title: "打开",
                url: "https://example.com",
              },
            ],
          },
          {
            type: "Table",
            columns: [{ width: 1 }],
            rows: [
              {
                type: "TableRow",
                cells: [
                  {
                    type: "TableCell",
                    items: [{ type: "TextBlock", text: "cell" }],
                  },
                ],
              },
            ],
          },
        ])
      ).ok
    ).toBe(true);
  });
  it("Image http url → ok（混合内容属 per-element，不整卡降级）", () => {
    expect(
      validateCardForOcto(AC([{ type: "Image", url: "http://x/a.png" }])).ok
    ).toBe(true);
  });
  it("Action.OpenUrl 安全 url + selectAction OpenUrl", () => {
    expect(
      validateCardForOcto(
        AC([
          {
            type: "Container",
            items: [],
            selectAction: { type: "Action.OpenUrl", url: "https://e.com" },
          },
        ],
        { actions: [{ type: "Action.OpenUrl", url: "https://e.com", title: "x" }] })
      ).ok
    ).toBe(true);
  });
  it("v2：Input.Text/Toggle/ChoiceSet + Action.Submit", () => {
    expect(
      validateCardForOcto(
        AC(
          [
            { type: "Input.Text", id: "t" },
            { type: "Input.Toggle", id: "g" },
            {
              type: "Input.ChoiceSet",
              id: "c",
              choices: [{ title: "a", value: "a" }],
            },
          ],
          { actions: [{ type: "Action.Submit", id: "ok", title: "提交" }] }
        ),
        V2
      ).ok
    ).toBe(true);
  });

  it("v2：Input.Number/Date/Time（P3-3 富输入）", () => {
    expect(
      validateCardForOcto(
        AC([
          { type: "Input.Number", id: "amount", min: 0, max: 100 },
          { type: "Input.Date", id: "date" },
          { type: "Input.Time", id: "time" },
        ]),
        V2
      ).ok
    ).toBe(true);
  });

  it("v2：输入的 inlineAction(Submit) 合法且 id 登记", () => {
    expect(
      validateCardForOcto(
        AC([
          {
            type: "Input.Text",
            id: "q",
            inlineAction: { type: "Action.Submit", id: "go" },
          },
        ]),
        V2
      ).ok
    ).toBe(true);
  });
});

describe("validateCardForOcto — 整卡降级（ok:false）", () => {
  const bad = (card: Record<string, unknown>, opts?: { allowInteractive: boolean }) =>
    expect(validateCardForOcto(card, opts).ok).toBe(false);

  it("非 AdaptiveCard 根", () => bad({ type: "Nope" }));
  it("未知元素", () => bad(AC([{ type: "Media" }])));
  it("RichTextBlock 只允许 TextRun inline", () =>
    bad(
      AC([
        { type: "RichTextBlock", inlines: [{ type: "TextBlock", text: "x" }] },
      ])
    ));
  it("TextRun.selectAction 也必须满足动作白名单与 URL 安全", () =>
    bad(
      AC([
        {
          type: "RichTextBlock",
          inlines: [
            {
              type: "TextRun",
              text: "bad",
              selectAction: {
                type: "Action.OpenUrl",
                url: "javascript:alert(1)",
              },
            },
          ],
        },
      ])
    ));
  it("TextRun 不能作为 body 元素单独出现", () =>
    bad(AC([{ type: "TextRun", text: "x" }])));
  it("ImageSet.images 只能包含 Image 元素", () =>
    bad(AC([{ type: "ImageSet", images: [{ type: "TextBlock", text: "x" }] }])));
  it("TableCell.items 非数组", () =>
    bad(AC([{ type: "Table", rows: [{ cells: [{ items: "bad" }] }] }])));
  it("元素无 type", () => bad(AC([{ text: "no type" }])));
  it("Input.* 在 v1（禁交互）", () => bad(AC([{ type: "Input.Text", id: "t" }])));
  it("Input.Number 在 v1（禁交互）", () =>
    bad(AC([{ type: "Input.Number", id: "n" }])));
  it("Input.Date 缺 id（v2，D1）", () =>
    bad(AC([{ type: "Input.Date" }]), V2));
  it("输入 inlineAction 为 Action.Execute（v2）→ 整卡降级", () =>
    bad(
      AC([
        {
          type: "Input.Text",
          id: "q",
          inlineAction: { type: "Action.Execute", id: "x" },
        },
      ]),
      V2
    ));
  it("输入 inlineAction id 与输入 id 冲突（v2，D1）→ 整卡降级", () =>
    bad(
      AC([
        {
          type: "Input.Text",
          id: "dup",
          inlineAction: { type: "Action.Submit", id: "dup" },
        },
      ]),
      V2
    ));
  it("Action.Submit 在 v1", () =>
    bad(AC([{ type: "TextBlock", text: "x" }], { actions: [{ type: "Action.Submit", id: "s" }] })));
  it("Action.Execute 在 v2（永不支持）", () =>
    bad(AC([{ type: "TextBlock", text: "x" }], { actions: [{ type: "Action.Execute", id: "e" }] }), V2));
  it("body 非数组", () => bad({ type: "AdaptiveCard", body: "bad" }));
  it("Container.items 非数组", () => bad(AC([{ type: "Container", items: "bad" }])));
  it("ColumnSet.columns 非数组", () => bad(AC([{ type: "ColumnSet", columns: "bad" }])));
  it("actions 非数组", () =>
    bad(AC([{ type: "TextBlock", text: "x" }], { actions: { foo: 1 } })));
  it("FactSet.facts 非数组", () => bad(AC([{ type: "FactSet", facts: "bad" }])));
  it("ChoiceSet.choices 非数组（v2）", () =>
    bad(AC([{ type: "Input.ChoiceSet", id: "c", choices: "bad" }]), V2));
  it("Column 显式非 Column type", () =>
    bad(AC([{ type: "ColumnSet", columns: [{ type: "TextBlock", text: "x" }] }])));
  it("Action.OpenUrl javascript: url", () =>
    bad(AC([{ type: "TextBlock", text: "x" }], {
      actions: [{ type: "Action.OpenUrl", url: "javascript:alert(1)", title: "x" }],
    })));
  it("selectAction Submit 在 v1", () =>
    bad(AC([{ type: "Container", items: [], selectAction: { type: "Action.Submit", id: "s" } }])));
  it("Input.* 缺 id（v2，D1）", () => bad(AC([{ type: "Input.Text" }]), V2));
  it("Action.Submit 缺 id（v2，D1）", () =>
    bad(AC([{ type: "TextBlock", text: "x" }], { actions: [{ type: "Action.Submit", title: "x" }] }), V2));
  it("帧内重复 id（Input 与 Submit 同 id，v2，D1）", () =>
    bad(AC([{ type: "Input.Text", id: "dup" }], { actions: [{ type: "Action.Submit", id: "dup" }] }), V2));
});

describe("validateCardForOcto — 真实预算上限（MAX_NODES=200 / MAX_DEPTH=16）", () => {
  it("201 个节点 → 越界降级", () => {
    const many = Array.from({ length: 201 }, () => ({ type: "TextBlock", text: "x" }));
    expect(validateCardForOcto(AC(many)).ok).toBe(false);
  });
  it("200 个节点 → 恰好合法", () => {
    const many = Array.from({ length: 200 }, () => ({ type: "TextBlock", text: "x" }));
    expect(validateCardForOcto(AC(many)).ok).toBe(true);
  });
  it("嵌套深度 17 层 → 越界降级", () => {
    let node: Record<string, unknown> = { type: "TextBlock", text: "deep" };
    for (let i = 0; i < 17; i++) node = { type: "Container", items: [node] };
    expect(validateCardForOcto(AC([node])).ok).toBe(false);
  });

  it("Input.ChoiceSet.choices 逐项计入预算 → 超量降级", () => {
    const choices = Array.from({ length: 201 }, (_, i) => ({
      title: `c${i}`,
      value: `${i}`,
    }));
    expect(
      validateCardForOcto(AC([{ type: "Input.ChoiceSet", id: "c", choices }]), {
        allowInteractive: true,
      }).ok
    ).toBe(false);
  });
});
