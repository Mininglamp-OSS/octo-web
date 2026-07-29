// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (src: string) => src } },
  },
}));

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

function expectPositioningStyles(root: HTMLElement) {
  const strut = root.querySelector<HTMLElement>(".katex-html .strut");
  expect(strut).not.toBeNull();
  expect(strut?.style.height).not.toBe("");
  expect(strut?.style.verticalAlign).not.toBe("");

  // KaTeX's fraction layout also depends on generated classes such as
  // `pstrut`; stripping these classes keeps the DOM but compresses its
  // measured vertical stack.
  const positioningStrut = root.querySelector<HTMLElement>(
    ".katex-html .pstrut"
  );
  expect(positioningStrut).not.toBeNull();
  expect(positioningStrut?.style.height).not.toBe("");
}

describe("MarkdownContent — KaTeX layout", () => {
  it("preserves generated positioning styles so fractions do not overlap", () => {
    const root = renderContent(
      <MarkdownContent content={String.raw`$$\frac{a}{b}$$`} />
    );
    expectPositioningStyles(root);
  });

  it("renders matrices with vertical spacing classes intact", () => {
    const root = renderContent(
      <MarkdownContent
        content={String.raw`$$\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}$$`}
      />
    );
    expectPositioningStyles(root);
    expect(root.querySelector(".katex .mtable")).not.toBeNull();
  });

  it("keeps nested fractions from collapsing", () => {
    const root = renderContent(
      <MarkdownContent content={String.raw`$$\frac{\frac{a}{b}}{c}$$`} />
    );
    expectPositioningStyles(root);
    const struts = root.querySelectorAll<HTMLElement>(".katex-html .pstrut");
    expect(struts.length).toBeGreaterThan(1);
  });

  it("renders block-level math with newlines inside $$ fences", () => {
    // With the mdast-util-from-markdown v2 override, remark-math@6's
    // flow-math path works natively. Block $$ produces .katex-display.
    const root = renderContent(
      <MarkdownContent content={"$$\n\\frac{a}{b}\n$$"} />
    );
    expect(root.querySelector(".katex")).not.toBeNull();
    expect(root.querySelector(".katex-display")).not.toBeNull();
  });

  it("does not crash on bare $$ or unclosed fence", () => {
    // These previously triggered TypeError in mdast-util-math@3's
    // exitMathFlowFence due to the v1/v2 CompileContext mismatch.
    expect(() => renderContent(<MarkdownContent content="$$" />)).not.toThrow();
    expect(() => renderContent(<MarkdownContent content={"$$\n\\frac{a}{b}"} />)).not.toThrow();
    expect(() => renderContent(<MarkdownContent content={"$$\n$$"} />)).not.toThrow();
  });

  it("does not crash on progressive streaming prefix", () => {
    // Simulates a bot streaming $$\nE = mc^2\n$$ — the prefix
    // before the closing fence arrives must not throw.
    const prefixes = [
      "$$",
      "$$\n",
      "$$\nE",
      "$$\nE = mc^2",
      "$$\nE = mc^2\n",
    ];
    for (const p of prefixes) {
      expect(() => renderContent(<MarkdownContent content={p} />)).not.toThrow();
    }
  });
});

describe("MarkdownContent — KaTeX maxSize guard", () => {
  it("clamps \\rule bomb to a bounded size", () => {
    const root = renderContent(
      <MarkdownContent content={String.raw`$$\rule{99999em}{99999em}$$`} />
    );
    const struts = root.querySelectorAll<HTMLElement>(".katex-html .strut");
    expect(struts.length).toBeGreaterThan(0);
    for (const s of struts) {
      const h = parseFloat(s.style.height || "0");
      expect(h).toBeLessThanOrEqual(10);
    }
  });
});

describe("MarkdownContent — single-dollar currency safety", () => {
  it("does not parse paired dollar signs as inline math", () => {
    const root = renderContent(
      <MarkdownContent content="I paid $5 and got $3 back" />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("$5");
    expect(root.textContent).toContain("$3");
  });

  it("does not parse shell-style $VAR as inline math", () => {
    const root = renderContent(
      <MarkdownContent content="Set $HOME and $PATH then run" />
    );
    expect(root.querySelector(".katex")).toBeNull();
    expect(root.textContent).toContain("$HOME");
    expect(root.textContent).toContain("$PATH");
  });
});
