// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    emojiService: {
      emojiRegExp: () => /\[有品位\]|\[OK\]/,
      getImage: (key: string) => {
        if (key === "[有品位]") return "./emoji/custom_taste.png";
        if (key === "[OK]") return "./emoji/ok.png";
        return "";
      },
    },
  },
}));

import ChannelSearchSnippetContent, {
  buildChannelSearchSnippetTokens,
  parseChannelSearchSnippetHighlights,
} from "../snippetContent";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (!container) return;
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  container = null;
});

function renderSnippet(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(element, container);
  });
  return container;
}

describe("ChannelSearchSnippetContent", () => {
  it("converts backend mark tags into highlight ranges without rendering html", () => {
    const parsed = parseChannelSearchSnippetHighlights(
      "你好<mark>搜索</mark><b>结果</b>",
      "nope"
    );

    expect(parsed).toEqual({
      text: "你好搜索<b>结果</b>",
      ranges: [{ start: 2, end: 4 }],
    });
  });

  it("renders a whole custom emoji when mark splits the emoji key", () => {
    const parsed = parseChannelSearchSnippetHighlights(
      "这个[有<mark>品</mark>位]不错",
      "品"
    );
    const tokens = buildChannelSearchSnippetTokens(
      parsed.text,
      parsed.ranges,
      (key) => (key === "[有品位]" ? "./emoji/custom_taste.png" : ""),
      /\[有品位\]/
    );

    expect(tokens).toEqual([
      { type: "text", text: "这个", highlighted: false },
      {
        type: "emoji",
        key: "[有品位]",
        url: "./emoji/custom_taste.png",
        highlighted: true,
      },
      { type: "text", text: "不错", highlighted: false },
    ]);
  });

  it("highlights a custom emoji when keyword matches inside the emoji key", () => {
    const parsed = parseChannelSearchSnippetHighlights("这个[有品位]不错", "品");
    const tokens = buildChannelSearchSnippetTokens(
      parsed.text,
      parsed.ranges,
      (key) => (key === "[有品位]" ? "./emoji/custom_taste.png" : ""),
      /\[有品位\]/
    );

    expect(tokens[1]).toMatchObject({
      type: "emoji",
      key: "[有品位]",
      highlighted: true,
    });
  });

  it("accepts global emoji regexes from custom emoji services", () => {
    const parsed = parseChannelSearchSnippetHighlights("[OK][OK]", "");
    const tokens = buildChannelSearchSnippetTokens(
      parsed.text,
      parsed.ranges,
      (key) => (key === "[OK]" ? "./emoji/ok.png" : ""),
      /\[OK\]/g
    );

    expect(tokens).toEqual([
      {
        type: "emoji",
        key: "[OK]",
        url: "./emoji/ok.png",
        highlighted: false,
      },
      {
        type: "emoji",
        key: "[OK]",
        url: "./emoji/ok.png",
        highlighted: false,
      },
    ]);
  });

  it("renders only emoji images and keeps unrelated html as text", () => {
    const root = renderSnippet(
      <ChannelSearchSnippetContent
        text={'hello <img src="x"> [OK]'}
        keyword="hello"
      />
    );

    expect(root.textContent).toContain('<img src="x">');
    expect(root.querySelectorAll("img")).toHaveLength(1);
    expect(root.querySelector("img")?.getAttribute("alt")).toBe("[OK]");
    expect(root.querySelector("mark")?.textContent).toBe("hello");
  });

  // Stored-XSS defence: server sets OpenSearch highlighter Encoder("html") so
  // uploader-controlled name/body/text arrives with the five XML entities
  // escaped; only <mark>/</mark> stay live. parseChannelSearchSnippetHighlights
  // must decode those entities so the visible text is the original characters,
  // and the render path must place them in React text nodes (never as HTML).
  it("decodes html entities inside plain and marked segments", () => {
    const parsed = parseChannelSearchSnippetHighlights(
      "prefix &lt;script&gt; &amp; <mark>renamed &quot;doc&quot;</mark> tail &#x27;",
      ""
    );
    expect(parsed).toEqual({
      text: "prefix <script> & renamed \"doc\" tail '",
      ranges: [{ start: 18, end: 31 }],
    });
  });

  it("never executes injected HTML in a hostile file name highlight", () => {
    // Simulate a file uploaded with a malicious name and a keyword that
    // overlaps the tokenized name: server returns the whole name with only
    // <mark> as live markup and everything else entity-escaped.
    const wire =
      "&lt;img src=x onerror=alert(1)&gt;.<mark>pdf</mark>";
    const root = renderSnippet(
      <ChannelSearchSnippetContent text={wire} keyword="pdf" />
    );
    // Visible text is the literal characters, no HTML element created.
    expect(root.textContent).toBe("<img src=x onerror=alert(1)>.pdf");
    expect(root.querySelector("img")).toBeNull();
    // The <mark> stays live (the ONLY tag the server preserved).
    expect(root.querySelector("mark")?.textContent).toBe("pdf");
  });

  it("never executes injected HTML in a hostile content snippet", () => {
    const wire =
      "quarterly &lt;script&gt;alert(1)&lt;/script&gt; report; <mark>渠道</mark> summary";
    const root = renderSnippet(
      <ChannelSearchSnippetContent text={wire} keyword="渠道" />
    );
    expect(root.textContent).toBe(
      "quarterly <script>alert(1)</script> report; 渠道 summary"
    );
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("mark")?.textContent).toBe("渠道");
  });
});
