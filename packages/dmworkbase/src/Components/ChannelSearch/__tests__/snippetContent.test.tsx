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
  decodeServerEscapedHighlight,
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
    const parsed = parseChannelSearchSnippetHighlights(
      "这个[有品位]不错",
      "品"
    );
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

  // The parser is encoding-agnostic: it extracts <mark> spans and passes every
  // other character through verbatim. Callers decode server-escaped fields at
  // the mapper boundary (see decodeServerEscapedHighlight and the mapFileHit
  // suite). This test pins that pre-existing shared paths — MessageHit.Snippet
  // from /_search, /_search_all, richText, mergeForward — are NOT rewritten
  // through the parser, so a user who genuinely typed `&amp;` or `<div>` in a
  // message body sees exactly those characters preserved in the snippet.
  it("preserves plain and marked segments verbatim (no entity decoding in the parser)", () => {
    const parsed = parseChannelSearchSnippetHighlights(
      "prefix &lt;script&gt; &amp; <mark>renamed &quot;doc&quot;</mark> tail &#x27;",
      ""
    );
    expect(parsed).toEqual({
      text: "prefix &lt;script&gt; &amp; renamed &quot;doc&quot; tail &#x27;",
      // The marked span is "renamed &quot;doc&quot;" (23 chars, positions
      // 28..51 within the concatenated plain text).
      ranges: [{ start: 28, end: 51 }],
    });
  });

  it("decodeServerEscapedHighlight decodes the entities Go html.EscapeString emits", () => {
    // The decode table follows what Go's html.EscapeString actually emits, not
    // Lucene's SimpleHTMLEncoder. Fixture values are lifted verbatim from the
    // paired server test at:
    //   octo-server modules/messages_search/search_files_test.go
    //     :: TestEscapeHighlightFragment / ampersand-quote-roundtrip
    // so the two suites can only disagree if someone changes the server on
    // purpose. If a future server change moves to a different encoder, the fix
    // is: update this fixture from the new server test, not from memory.

    // Angle brackets — Go emits named forms for <>&.
    expect(decodeServerEscapedHighlight("&lt;a&gt;")).toBe("<a>");
    // Double quote — Go emits DECIMAL &#34;, not named &quot;.
    expect(decodeServerEscapedHighlight("&#34;q&#34;")).toBe('"q"');
    // Apostrophe — Go emits DECIMAL &#39;, not hex &#x27;.
    expect(decodeServerEscapedHighlight("john&#39;s")).toBe("john's");
    // Ampersand — round-trip.
    expect(decodeServerEscapedHighlight("R&amp;D")).toBe("R&D");
    // End-to-end fixture lifted verbatim from the server's own
    // TestEscapeHighlightFragment want-string. If this test breaks in isolation
    // from a server change, the paired change should have shipped as one PR.
    expect(
      decodeServerEscapedHighlight("R&amp;D &#34;v2&#34; <mark>foo</mark>")
    ).toBe('R&D "v2" <mark>foo</mark>');
    // Slash is NOT escaped by Go html.EscapeString — passthrough.
    expect(
      decodeServerEscapedHighlight("see https://acme.co/q3 2026/09/02")
    ).toBe("see https://acme.co/q3 2026/09/02");
    // Single-decode invariant (no double-unescape): the user-typed characters
    // `&lt;` must survive as literal `&lt;`, not decode all the way to `<`.
    expect(decodeServerEscapedHighlight("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });

  it("never executes injected HTML in a hostile file name highlight (post-decode)", () => {
    // Simulate the end-to-end wire: the mapper (mapFileHit) decodes the
    // server-escaped fragment before handing it to the parser. Downstream the
    // parser extracts <mark> and every other character renders as a React text
    // node — the hostile HTML never becomes markup.
    const wire = "&lt;img src=x onerror=alert(1)&gt;.<mark>pdf</mark>";
    const decoded = decodeServerEscapedHighlight(wire);
    const root = renderSnippet(
      <ChannelSearchSnippetContent text={decoded} keyword="pdf" />
    );
    expect(root.textContent).toBe("<img src=x onerror=alert(1)>.pdf");
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector("mark")?.textContent).toBe("pdf");
  });

  it("never executes injected HTML in a hostile content snippet (post-decode)", () => {
    const wire =
      "quarterly &lt;script&gt;alert(1)&lt;/script&gt; report; <mark>渠道</mark> summary";
    const decoded = decodeServerEscapedHighlight(wire);
    const root = renderSnippet(
      <ChannelSearchSnippetContent text={decoded} keyword="渠道" />
    );
    expect(root.textContent).toBe(
      "quarterly <script>alert(1)</script> report; 渠道 summary"
    );
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector("mark")?.textContent).toBe("渠道");
  });
});
