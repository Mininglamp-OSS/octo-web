// @vitest-environment jsdom
//
// B3 re-review guard (feature #511): the forwarded-doc title clamp must fire ONLY on the real
// forward shape `**title**\n[title](link)` and never on ordinary "bold-lead + link" markdown.
//
// Earlier the predicate was just "first child bold AND some link", so any message like
// `**Note:** see [the docs](url)` or `**bold** [link](url)` was mistaken for a forward card and
// wrongly clamped to 2 lines (a visible regression on normal messages). These DOM assertions render
// through the actual MarkdownContent paragraph path and check the clamp class is applied to a true
// forward and withheld from the false-positive shapes.

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// MarkdownContent statically imports WKApp; only the inline-image path touches dataSource. These
// tests render no images, so a minimal stub avoids pulling the whole App dependency chain.
vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (src: string) => src } },
  },
}));

// The i18n barrel indirectly loads lottie-web (crashes in jsdom without canvas). We only need `t`
// to echo keys back, mirroring the sibling MarkdownContent test.
vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

import MarkdownContent from "../MarkdownContent";

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

describe("MarkdownContent — forwarded-doc title clamp gate (B3)", () => {
  const url = "https://octo.example.com/docs?space=demo&doc=d_1";

  it("clamps a genuine forward card `**title**\\n[title](link)`", () => {
    // remark-breaks turns the single newline into a <br>, so this is strong + break + link with the
    // link label equal to the bold title — the exact forward shape.
    const root = renderContent(
      <MarkdownContent content={`**Quarterly plan**\n[Quarterly plan](${url})`} />
    );
    expect(root.querySelector(".wk-markdown-forward-card")).not.toBeNull();
    expect(root.querySelector(".wk-markdown-forward-title")).not.toBeNull();
  });

  it("exposes the FULL title in the clamped bold run's `title` tooltip (XIN-450 P1)", () => {
    // Regression: react-markdown 8.x always hands `strong` an ARRAY of children, so the old
    // `typeof children === "string"` guard resolved to undefined and the `title` attribute was never
    // set → the hover tooltip disappeared for every clamped forward card. plainText() reads the
    // array-shaped children, restoring the tooltip that reveals the title clamped to 2 lines.
    const root = renderContent(
      <MarkdownContent content={`**Quarterly roadmap and long title**\n[Quarterly roadmap and long title](${url})`} />
    );
    const titleEl = root.querySelector(".wk-markdown-forward-title");
    expect(titleEl).not.toBeNull();
    expect(titleEl?.getAttribute("title")).toBe("Quarterly roadmap and long title");
  });

  it("does NOT clamp `**Note:** see [the docs](url)` (bold intro + unrelated link)", () => {
    const root = renderContent(
      <MarkdownContent content={`**Note:** see [the docs](${url})`} />
    );
    expect(root.querySelector(".wk-markdown-forward-card")).toBeNull();
    // The link and bold text still render normally — nothing is dropped.
    expect(root.querySelector("strong")?.textContent).toBe("Note:");
    expect(root.querySelector("a")?.textContent).toBe("the docs");
  });

  it("does NOT clamp `**bold** [link](url)` (adjacent bold + link, label ≠ title)", () => {
    const root = renderContent(
      <MarkdownContent content={`**bold** [link](${url})`} />
    );
    expect(root.querySelector(".wk-markdown-forward-card")).toBeNull();
  });

  it("does NOT clamp a strong→break→link whose link label differs from the bold title", () => {
    const root = renderContent(
      <MarkdownContent content={`**Heading**\n[open here](${url})`} />
    );
    expect(root.querySelector(".wk-markdown-forward-card")).toBeNull();
  });
});
