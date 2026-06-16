// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../TextContent", () => ({
  default: ({
    content,
    mentions = [],
    emojis = [],
    onMentionClick,
    enableMarkdown,
  }: {
    content: string;
    mentions?: Array<{ name: string; uid: string }>;
    emojis?: Array<{ key: string; url: string }>;
    onMentionClick?: (uid: string) => void;
    enableMarkdown?: boolean;
  }) => (
    <span
      data-mentions={JSON.stringify(mentions)}
      data-emojis={JSON.stringify(emojis)}
      data-enable-markdown={String(enableMarkdown)}
      onClick={() => mentions[0]?.uid && onMentionClick?.(mentions[0].uid)}
    >
      {content}
    </span>
  ),
}));

vi.mock("../../../../Messages/Text/MarkdownContent", () => ({
  MarkdownImage: ({ src, alt }: { src: string; alt?: string }) => (
    <img src={src} alt={alt || ""} />
  ),
}));

import MixedContent from "../index";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderMixed(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

describe("MixedContent", () => {
  it("按块渲染文本、图片和文件卡片", () => {
    const root = renderMixed(
      <MixedContent
        blocks={[
          { id: "t1", type: "text", content: "看这个" },
          { id: "i1", type: "image", src: "https://x/a.png", alt: "截图" },
          {
            id: "f1",
            type: "file",
            name: "需求说明.pdf",
            size: "2.0 KB",
            extension: "PDF",
            iconLabel: "PDF",
            url: "https://x/a.pdf",
          },
        ]}
      />
    );

    expect(root.textContent).toContain("看这个");
    expect(root.querySelector('img[alt="截图"]')?.getAttribute("src")).toBe(
      "https://x/a.png"
    );
    expect(root.textContent).toContain("需求说明.pdf");
    expect(root.textContent).toContain("2.0 KB");
  });

  it("点击文件下载按钮时回调 file block", () => {
    const onFileDownload = vi.fn();
    const root = renderMixed(
      <MixedContent
        blocks={[
          {
            id: "f1",
            type: "file",
            name: "需求说明.pdf",
            size: "2.0 KB",
            extension: "PDF",
            iconLabel: "PDF",
            url: "https://x/a.pdf",
          },
        ]}
        onFileDownload={onFileDownload}
      />
    );

    const button = root.querySelector("button");
    expect(button).not.toBeNull();
    act(() => {
      button?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(onFileDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", type: "file" })
    );
  });

  it("文本块关闭 markdown 解析但保留 mention、emoji 和点击回调", () => {
    const onMentionClick = vi.fn();
    const root = renderMixed(
      <MixedContent
        blocks={[
          {
            id: "t1",
            type: "text",
            content: "@Alice [OK]",
            mentions: [{ name: "@Alice", uid: "alice" }],
            emojis: [{ key: "[OK]", url: "emoji://ok" }],
          },
        ]}
        onMentionClick={onMentionClick}
      />
    );

    const text = root.querySelector(".wk-msg-mixed-text span");
    expect(text?.getAttribute("data-mentions")).toContain("alice");
    expect(text?.getAttribute("data-emojis")).toContain("emoji://ok");
    expect(text?.getAttribute("data-enable-markdown")).toBe("false");
    act(() => {
      text?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });
    expect(onMentionClick).toHaveBeenCalledWith("alice");
  });
});
