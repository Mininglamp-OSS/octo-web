import React from "react";
import ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { act } from "react-dom/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import ReplyBlock from "../index";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderBlock(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

/**
 * dmwork-web#1069 round 3 — UI consumer-side coverage.
 *
 * 背景：
 *   PR#1073 (R2) 通过 `patchSdkDecodeForExternalFields()` 把
 *   `from_home_space_*` / legacy `from_*` 字段挂到 `message.content.reply`，
 *   但 round 2 的 UT 仅验证「字段被挂上了」，没有验证「渲染层真的读出来」。
 *   lml2468 的 blocking review 点出：ReplyBlock 原先只读 fromName，
 *   外部成员的 reply 预览不会显示 `@SpaceName`。
 *
 * 这组测试在「渲染产物是否包含 @SpaceName」这一层扎一个断言，
 * 一旦 UI 退回仅读 fromName 就会红。
 */
describe("ReplyBlock — external source space suffix", () => {
  it("renders only the nickname when sourceSpaceName is absent", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock fromName="嘉伟qq" digest="hello" />
    );
    expect(html).toContain("嘉伟qq");
    expect(html).toContain("hello");
    expect(html).not.toContain("@");
    expect(html).not.toMatch(/wk-reply-block__space/);
  });

  it("renders the `@SpaceName` suffix when sourceSpaceName is non-empty (dmwork-web#1069)", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock
        fromName="嘉伟qq"
        digest="hello"
        sourceSpaceName="测试空间1"
      />
    );
    expect(html).toContain("嘉伟qq");
    // 关键断言：外部成员后缀必须出现在渲染产物里；如果回归到仅读 fromName
    // 则下面任一断言都会 fail。
    expect(html).toContain("@测试空间1");
    expect(html).toMatch(/wk-reply-block__space/);
    // title 属性给长文本的 hover 显示
    expect(html).toMatch(/title="@测试空间1"/);
  });

  it("treats empty/whitespace-safe values the same as absent", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock fromName="嘉伟qq" digest="hello" sourceSpaceName="" />
    );
    expect(html).not.toMatch(/wk-reply-block__space/);
  });

  it("keeps digest visible alongside the suffix", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock
        fromName="Alice"
        digest="This is the quoted content"
        sourceSpaceName="ExampleCorp"
      />
    );
    expect(html).toContain("Alice");
    expect(html).toContain("This is the quoted content");
    expect(html).toContain("@ExampleCorp");
  });
});

describe("ReplyBlock — digest links", () => {
  it("renders safe URL text as a clickable link", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock fromName="Alice" digest="请看 https://example.com/docs。" />
    );

    expect(html).toContain('class="wk-reply-block__digest-link"');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("https://example.com/docs");
    expect(html).toContain("。");
  });

  it("normalizes www links to safe https hrefs", () => {
    const html = renderToStaticMarkup(
      <ReplyBlock fromName="Alice" digest="官网 www.example.com" />
    );

    expect(html).toContain('href="https://www.example.com"');
    expect(html).toContain(">www.example.com</a>");
  });

  it("does not trigger reply-block navigation when clicking a digest link", () => {
    const onClick = vi.fn();
    const root = renderBlock(
      <ReplyBlock
        fromName="Alice"
        digest="请看 https://example.com/docs"
        onClick={onClick}
      />
    );

    const link = root.querySelector(".wk-reply-block__digest-link");
    expect(link).not.toBeNull();
    act(() => {
      link?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(onClick).not.toHaveBeenCalled();

    act(() => {
      root
        .querySelector(".wk-reply-block")
        ?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
    });
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
