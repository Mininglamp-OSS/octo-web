// sanitizeCardTree：图片类 URL https-only 消毒（喂 SDK 前）。不可变、不动 Action.OpenUrl.url。

import { describe, expect, it } from "vitest";
import { sanitizeCardTree } from "../sdk/sanitizeCardTree";

describe("sanitizeCardTree — 图片面 https-only", () => {
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

  it("data:/javascript: Image.url → 剥除（无 scheme 逃逸）", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [
        { type: "Image", url: "data:image/svg+xml,<svg/>" },
        { type: "Image", url: "javascript:alert(1)" },
      ],
    }) as any;
    expect(out.body[0].url).toBeUndefined();
    expect(out.body[1].url).toBeUndefined();
  });

  it("backgroundImage 字符串与 {url} 两形 → 非 https 剥除、https 保留", () => {
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
      ],
    }) as any;
    expect(out.backgroundImage).toBeUndefined(); // 根 http 背景剥除
    expect(out.body[0].backgroundImage).toBe("https://cdn/bg.png"); // https 字符串保留
    expect(out.body[1].backgroundImage).toBeUndefined(); // {url} http 剥除
  });

  it("Action.*.iconUrl 非 https → 剥除；但 Action.OpenUrl.url（导航面）不动", () => {
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
      ],
    }) as any;
    expect(out.actions[0].url).toBe("http://example.com/page"); // 导航 url 不动
    expect(out.actions[0].iconUrl).toBeUndefined(); // icon http 剥除
    expect(out.actions[1].iconUrl).toBe("https://cdn/icon.png");
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

  it("fallback:\"drop\" 字符串形也被剥除", () => {
    const out = sanitizeCardTree({
      type: "AdaptiveCard",
      body: [{ type: "Image", url: "https://cdn/a.png", fallback: "drop" }],
    }) as any;
    expect(out.body[0].fallback).toBeUndefined();
    expect(out.body[0].url).toBe("https://cdn/a.png");
  });
});
