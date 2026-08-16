// sanitizeCardTree：图片面 URL 白名单消毒（喂 SDK 前）。不可变、不动 Action.OpenUrl.url。

import { describe, expect, it, vi } from "vitest";
import { sanitizeCardTree } from "../sdk/sanitizeCardTree";

/** 模板内联图标（受限 data URL 白名单，详见 inlineImageUrl.test.ts）。 */
const SAFE_SVG_DATA_URL = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg"><path d="m6 9l6 6l6-6"/></svg>'
)}`;

describe("sanitizeCardTree — 图片面白名单（https + 内联 SVG）", () => {
  it("Image.url 非 https → 剥除；https → 保留", () => {
    const httpImg = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "http://evil/track.png", altText: "x" }],
    }) as any;
    expect(httpImg.body[0].url).toBeUndefined();
    expect(httpImg.body[0].altText).toBe("x"); // 其余字段保留

    const httpsImg = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "https://cdn/a.png" }],
    }) as any;
    expect(httpsImg.body[0].url).toBe("https://cdn/a.png");
  });

  it("受限 SVG data URL 保留；不合白名单的 data:/javascript: → 剥除", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [
        { type: "Image", url: SAFE_SVG_DATA_URL },
        { type: "Image", url: "data:text/html,%3Ch1%3Ex%3C%2Fh1%3E" },
        { type: "Image", url: "data:image/png;base64,iVBORw0KGgo=" },
        {
          type: "Image",
          url: `data:image/svg+xml,${encodeURIComponent(
            '<svg onload="alert(1)"/>'
          )}`,
        },
        { type: "Image", url: "javascript:alert(1)" },
      ],
    }) as any;
    expect(out.body[0].url).toBe(SAFE_SVG_DATA_URL); // 内联图标照渲
    expect(out.body[1].url).toBeUndefined(); // text/html
    expect(out.body[2].url).toBeUndefined(); // 位图 data URL（服务端未开）
    expect(out.body[3].url).toBeUndefined(); // 带事件属性的 SVG
    expect(out.body[4].url).toBeUndefined(); // javascript:
  });

  it("backgroundImage 字符串与 {url} 两形 → 不合白名单剥除、合规保留", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      backgroundImage: "http://evil/bg.png",
      body: [
        { type: "Container", items: [], backgroundImage: "https://cdn/bg.png" },
        {
          type: "ColumnSet",
          backgroundImage: { url: "http://evil/bg2.png", fillMode: "cover" },
          columns: [],
        },
        {
          type: "Container",
          items: [],
          backgroundImage: { url: SAFE_SVG_DATA_URL, fillMode: "repeat" },
        },
      ],
    }) as any;
    expect(out.backgroundImage).toBeUndefined(); // 根 http 背景剥除
    expect(out.body[0].backgroundImage).toBe("https://cdn/bg.png"); // https 字符串保留
    expect(out.body[1].backgroundImage).toBeUndefined(); // {url} http 剥除
    expect(out.body[2].backgroundImage).toEqual({
      url: SAFE_SVG_DATA_URL,
      fillMode: "repeat",
    }); // {url} 内联 SVG 保留
  });

  it("Action.*.iconUrl 非白名单 → 剥除；但 Action.OpenUrl.url（导航面）不动", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "TextBlock", text: "x" }],
      actions: [
        {
          type: "Action.OpenUrl",
          title: "看",
          url: "http://example.com/page", // 导航面：http 允许，保留
          iconUrl: "http://evil/icon.png", // 图片面：剥除
        },
        {
          type: "Action.Submit",
          id: "ok",
          iconUrl: "https://cdn/icon.png", // https 图标保留
        },
        {
          type: "Action.Submit",
          id: "inline",
          iconUrl: SAFE_SVG_DATA_URL, // 内联 SVG 图标保留
        },
      ],
    }) as any;
    expect(out.actions[0].url).toBe("http://example.com/page"); // 导航 url 不动
    expect(out.actions[0].iconUrl).toBeUndefined(); // icon http 剥除
    expect(out.actions[1].iconUrl).toBe("https://cdn/icon.png");
    expect(out.actions[2].iconUrl).toBe(SAFE_SVG_DATA_URL);
  });

  it("嵌套（Container>Image）也被消毒", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [
        {
          type: "Container",
          items: [{ type: "Image", url: "http://evil/nested.png" }],
        },
      ],
    }) as any;
    expect(out.body[0].items[0].url).toBeUndefined();
  });

  it("不可变：不改动传入卡树", () => {
    const input = {
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "http://evil/track.png" }],
    };
    const snapshot = JSON.stringify(input);
    sanitizeCardTree(input);
    expect(JSON.stringify(input)).toBe(snapshot); // 原对象未被修改
  });

  it("被剥除的图片 URL 在 DEV 下有 console.warn（避免又一次静默丢图标）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      sanitizeCardTree({
        type: "AdaptiveCard",
        body: [{ type: "Image", url: "http://evil/track.png" }],
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("Image.url");
    } finally {
      warn.mockRestore();
    }
  });

  it("合规 URL 不产生噪音", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      sanitizeCardTree({
        type: "AdaptiveCard",
        body: [
          { type: "Image", url: "https://cdn/a.png" },
          { type: "Image", url: SAFE_SVG_DATA_URL },
        ],
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("sanitizeCardTree — __proto__ 不得复活被剥除的键", () => {
  it("输入里 __proto__ 携带的 url 不出现在输出上", () => {
    // out[key] = … 会命中原型 setter，把 url 从原型链上「复活」：消毒后的节点
    // 会暴露输入里并不存在的键。内层对象没有 type:"Image"，url 门根本不会作用于它。
    const input = JSON.parse(
      '{"type":"AdaptiveCard","body":[{"type":"Image","altText":"x","__proto__":{"url":"javascript:alert(1)"}}]}'
    );
    expect(input.body[0].url).toBeUndefined(); // 前提：输入上读不到 url

    const out = sanitizeCardTree(input) as any;
    expect(out.body[0].url).toBeUndefined(); // 输出同样读不到
    expect(out.body[0].altText).toBe("x"); // 其余字段不受影响
    // 全局原型未被污染
    expect(({} as any).url).toBeUndefined();
  });

  it("输出对象仍保有正常原型（SDK internalParse 依赖 hasOwnProperty）", () => {
    // 这也是不能用 Object.create(null) 修上一条的原因：无原型对象上
    // source.hasOwnProperty(...) 不存在，SDK 解析会直接抛。
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "https://cdn/a.png" }],
    }) as any;
    expect(typeof out.hasOwnProperty).toBe("function");
    expect(typeof out.body[0].hasOwnProperty).toBe("function");
    expect(out.body[0].hasOwnProperty("url")).toBe(true);
  });
});

describe("sanitizeCardTree — 剥除 fallback / requires（SDK 渲染面收敛）", () => {
  it("元素的 fallback 与 requires 被剥除（防未校验子树被 SDK 渲染）", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [
        {
          type: "TextBlock",
          text: "x",
          requires: { cap: "1" },
          fallback: { type: "Input.Text", id: "sneaky" },
        },
      ],
    }) as any;
    expect(out.body[0].requires).toBeUndefined();
    expect(out.body[0].fallback).toBeUndefined();
    expect(out.body[0].text).toBe("x"); // 主元素其余字段保留
  });

  it("嵌套 fallback（Container 内元素）也被剥除", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [
        {
          type: "Container",
          items: [
            {
              type: "TextBlock",
              text: "y",
              fallback: {
                type: "Container",
                items: [{ type: "TextBlock", text: "bomb" }],
              },
            },
          ],
        },
      ],
    }) as any;
    expect(out.body[0].items[0].fallback).toBeUndefined();
  });

  it('fallback:"drop" 字符串形也被剥除', () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "https://cdn/a.png", fallback: "drop" }],
    }) as any;
    expect(out.body[0].fallback).toBeUndefined();
    expect(out.body[0].url).toBe("https://cdn/a.png");
  });
});
