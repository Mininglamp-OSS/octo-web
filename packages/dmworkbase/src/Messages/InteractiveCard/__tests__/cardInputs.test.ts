// @vitest-environment jsdom
//
// cardInputs：SDK 输入收集 + 提交前大小预校验。

import { beforeAll, describe, expect, it } from "vitest";
import { AdaptiveCard } from "adaptivecards";
import { collectCardInputs, validateCardInputs } from "../sdk/cardInputs";

beforeAll(() => {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
  }
  AdaptiveCard.onProcessMarkdown = (text, result) => {
    result.outputHtml = text;
    result.didProcess = true;
  };
});

describe("collectCardInputs", () => {
  it("收集声明的 Input.* 值（id → 字符串）", () => {
    const card = new AdaptiveCard();
    card.parse({
      type: "AdaptiveCard",
      version: "1.5",
      body: [
        { type: "Input.Text", id: "note", value: "hello" },
        { type: "Input.Toggle", id: "agree" },
      ],
    });
    // getAllInputs 读的是已渲染输入元素的值，故先挂载。
    const target = document.createElement("div");
    document.body.appendChild(target);
    const rendered = card.render();
    if (rendered) target.appendChild(rendered);
    const inputs = collectCardInputs(card);
    expect(inputs.note).toBe("hello");
    expect(inputs).toHaveProperty("agree");
    expect(typeof inputs.agree).toBe("string");
    target.remove();
  });
});

describe("validateCardInputs — 大小上限", () => {
  it("正常输入 → null", () => {
    expect(validateCardInputs({ note: "hi", size: "l" })).toBeNull();
    expect(validateCardInputs({})).toBeNull();
  });

  it("单字段 > 4KiB → field-too-long", () => {
    expect(validateCardInputs({ note: "x".repeat(4097) })).toBe(
      "field-too-long"
    );
  });

  it("总量 > 16KiB → total-too-large（各字段均 ≤ 4KiB）", () => {
    const inputs: Record<string, string> = {};
    for (let i = 0; i < 5; i++) inputs[`f${i}`] = "x".repeat(4000);
    expect(validateCardInputs(inputs)).toBe("total-too-large");
  });
});
