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
});
