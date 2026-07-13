// @vitest-environment jsdom
//
// SDK 契约金丝雀：锁定我们依赖的官方 adaptivecards 四个扩展点行为不随升级漂移
// （onProcessMarkdown / onExecuteAction no-data / 受限 registry / HostConfig）。
// 生产渲染路径见 sdk/renderOctoCard + InteractiveCardCell；此文件专盯 SDK 能力假设。

import { beforeAll, describe, expect, it } from "vitest";
import {
  AdaptiveCard,
  HostConfig,
  SerializationContext,
  CardObjectRegistry,
  GlobalRegistry,
} from "adaptivecards";

// jsdom 缺失的浏览器 API 兜底（SDK 渲染路径可能触及）。
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
  // 发现：AC SDK 未设 markdown 处理器时，含 markdown 的 TextBlock 文本渲染为空。
  // 故 onProcessMarkdown 是基础文本渲染的必需项（真实集成恒设为自研 sanitizer）。
  // 这里设一个透传默认，代表真实集成条件；个别用例可临时覆盖再恢复。
  AdaptiveCard.onProcessMarkdown = (text, result) => {
    result.outputHtml = text;
    result.didProcess = true;
  };
});

const V2_SAMPLE = {
  type: "AdaptiveCard",
  version: "1.5",
  body: [
    { type: "TextBlock", text: "**订单** 待处理", wrap: true },
    {
      type: "FactSet",
      facts: [
        { title: "单号", value: "A-1001" },
        { title: "金额", value: "¥128" },
      ],
    },
    {
      type: "ColumnSet",
      columns: [
        { type: "Column", items: [{ type: "TextBlock", text: "左" }] },
        { type: "Column", items: [{ type: "TextBlock", text: "右" }] },
      ],
    },
    { type: "Input.Text", id: "note", placeholder: "备注" },
    {
      type: "Input.ChoiceSet",
      id: "size",
      choices: [
        { title: "小", value: "s" },
        { title: "大", value: "l" },
      ],
    },
    { type: "Input.Toggle", id: "agree", title: "我同意" },
  ],
  actions: [{ type: "Action.Submit", id: "approve", title: "通过", data: { secret: 1 } }],
};

function newCard(): AdaptiveCard {
  const card = new AdaptiveCard();
  card.hostConfig = new HostConfig({ fontFamily: "SpikeFont, sans-serif" });
  return card;
}

describe("SPIKE 扩展点1 — onProcessMarkdown 可插入自研 sanitizer（XSS 控制在我们手里）", () => {
  it("markdown 走我们的处理器；危险链接被我们剥离", () => {
    let called = false;
    AdaptiveCard.onProcessMarkdown = (text, result) => {
      called = true;
      // 模拟自研 sanitizer：剥掉 javascript: 链接，只留可见文本 + 打标记。
      const safe = text.replace(/\[([^\]]*)\]\(javascript:[^)]*\)/gi, "$1");
      result.outputHtml = `<span data-spike-sanitized="1">${safe}</span>`;
      result.didProcess = true;
    };
    const card = newCard();
    card.parse({
      type: "AdaptiveCard",
      version: "1.5",
      body: [{ type: "TextBlock", text: "点[这里](javascript:alert(1))看" }],
    });
    const el = card.render()!;
    expect(called).toBe(true);
    expect(el.querySelector("[data-spike-sanitized]")).not.toBeNull();
    // 危险 scheme 未进入 DOM。
    expect(el.innerHTML).not.toContain("javascript:");
    // 恢复透传默认（beforeAll 设定），不影响后续用例。
    AdaptiveCard.onProcessMarkdown = (text, result) => {
      result.outputHtml = text;
      result.didProcess = true;
    };
  });
});

describe("SPIKE 扩展点2 — onExecuteAction 拦 Submit：只取 id、可丢 data（D11）", () => {
  it("点击 Submit → 回调拿到 action，能读 id/type 并忽略 data；getAllInputs 拿到输入", () => {
    let captured: any = null;
    const card = newCard();
    card.onExecuteAction = (action) => {
      captured = action;
    };
    card.parse(V2_SAMPLE);
    const el = card.render()!;
    document.body.appendChild(el);

    const inputs = card.getAllInputs();
    const inputIds = inputs.map((i) => i.id).sort();
    expect(inputIds).toEqual(["agree", "note", "size"]);

    const btn = el.querySelector("button") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    btn.click();

    expect(captured).not.toBeNull();
    expect(captured.getJsonTypeName()).toBe("Action.Submit");
    expect(captured.id).toBe("approve");
    // data 存在（SDK 会把 inputs 合进 data），但 D11 下我们「选择不回传」——只用 id。
    // 这里断言我们能拿到 id 而无需碰 data，证明 no-data 提交可实现。
    el.remove();
  });
});

describe("SPIKE 扩展点3 — 受限 registry / onParseElement 可识别非白名单元素", () => {
  it("onParseElement 能枚举解析到的元素类型（供整卡降级预判）", () => {
    const seen: string[] = [];
    const ctx = new SerializationContext();
    ctx.onParseElement = (element) => {
      seen.push(element.getJsonTypeName());
    };
    const card = newCard();
    card.parse(V2_SAMPLE, ctx);
    // 至少枚举到我们关心的类型，证明可在解析期检测非白名单并触发整卡降级。
    expect(seen).toContain("TextBlock");
    expect(seen).toContain("Input.Text");
    expect(seen).toContain("Input.ChoiceSet");
  });

  it("受限 element registry 去掉 Table 后，Table 不产出表格 DOM", () => {
    const elementReg = new CardObjectRegistry<any>();
    GlobalRegistry.populateWithDefaultElements(elementReg);
    elementReg.unregister("Table"); // 模拟 octo 白名单：不允许 Table
    const ctx = new SerializationContext();
    ctx.setElementRegistry(elementReg);

    const card = newCard();
    card.parse(
      {
        type: "AdaptiveCard",
        version: "1.5",
        body: [
          { type: "TextBlock", text: "x" },
          { type: "Table", columns: [{ width: 1 }], rows: [] },
        ],
      },
      ctx
    );
    const el = card.render();
    // Table 未注册 → 不应渲染出表格结构。
    expect(el?.querySelector("table")).toBeNull();
  });
});

describe("SPIKE 扩展点4 + 端到端 — HostConfig + octo/v2 子集渲染", () => {
  it("HostConfig 被接受，octo/v2 样例卡渲染出 input/select/checkbox/button + 两列", () => {
    const card = newCard();
    card.parse(V2_SAMPLE);
    const el = card.render()!;
    document.body.appendChild(el);

    expect(el.querySelector("input[type=text], textarea")).not.toBeNull();
    expect(el.querySelector("select")).not.toBeNull();
    expect(el.querySelector("input[type=checkbox]")).not.toBeNull();
    expect(el.querySelector("button")).not.toBeNull();
    expect(el.textContent).toContain("单号");
    expect(el.textContent).toContain("左");
    expect(el.textContent).toContain("右");
    el.remove();
  });
});
