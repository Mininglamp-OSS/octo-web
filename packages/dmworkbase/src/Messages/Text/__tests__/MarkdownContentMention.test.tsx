// @vitest-environment jsdom
//
// GH#295 regression — Web 端广播 mention 需要保持可见高亮。
// GH#1153 明确该高亮属于三等级视觉里的纯紫文字，而不是普通成员胶囊。
//
// 背景：广播 mention（"@所有人"）在 buildMessageMentions 里被合成为
// {name:"@所有人", uid:"all"}（见 Utils/mentionRender.ts），交给
// MarkdownContent 渲染。这里直接 render MarkdownContent，断言广播 mention 产出
// 非交互的 `.mention-highlight`，同时普通成员 mention 仍是 `.mention-entity` 胶囊。

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// MarkdownContent 静态 import 了 ../../App（WKApp），仅在内联图片渲染路径才会
// 真正访问 dataSource。这里的测试不渲染图片，给一个最小桩避免拉起整条 App 依赖链。
vi.mock("../../../App", () => ({
  default: {
    dataSource: {
      commonDataSource: {
        getImageURL: (src: string) => src,
      },
    },
  },
}));

// i18n 的 barrel 入口会间接拉起 lottie-web（jsdom 无 canvas 会崩在模块加载期）。
// 测试只需要 `t` 做兜底回显，桩掉即可，与 MessageRow.test 同款做法。
vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

import MarkdownContent, { type MentionInfo } from "../MarkdownContent";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderContent(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

describe("MarkdownContent — broadcast mention (@所有人) 高亮渲染", () => {
  it("把广播 mention 渲染成 span.mention-highlight，文本为 @所有人", () => {
    const mentions: MentionInfo[] = [{ name: "@所有人", uid: "all" }];
    const root = renderContent(
      <MarkdownContent content="@所有人 测试一下" mentions={mentions} />
    );

    const highlight = root.querySelector("span.mention-highlight");
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toBe("@所有人");
  });

  it("广播 mention 与普通成员 mention 保持三等级视觉区分", () => {
    const mentions: MentionInfo[] = [
      { name: "@所有人", uid: "all" },
      { name: "@张三", uid: "uid_zhang" },
    ];
    const root = renderContent(
      <MarkdownContent content="@所有人 和 @张三 看一下" mentions={mentions} />
    );

    const highlights = Array.from(
      root.querySelectorAll("span.mention-highlight")
    ).map((el) => el.textContent);
    const entities = Array.from(root.querySelectorAll("span.mention-entity")).map(
      (el) => el.textContent
    );
    expect(highlights).toContain("@所有人");
    expect(entities).toContain("@张三");
  });
});

describe("MarkdownContent — raw HTML displays as text", () => {
  it("renders pasted HTML source instead of dropping the tag", () => {
    const root = renderContent(
      <MarkdownContent content={'<button class="x">Octo 登录</button>'} />
    );

    expect(root.querySelector("button")).toBeNull();
    expect(root.textContent).toBe('<button class="x">Octo 登录</button>');
  });

  it("keeps empty HTML tags visible", () => {
    const root = renderContent(
      <MarkdownContent content={'<button class="x"></button>'} />
    );

    expect(root.querySelector("button")).toBeNull();
    expect(root.textContent).toBe('<button class="x"></button>');
  });
});
