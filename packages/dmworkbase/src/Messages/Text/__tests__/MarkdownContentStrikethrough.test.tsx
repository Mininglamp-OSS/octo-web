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

function renderContent(content: string, enableMath = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(
      <MarkdownContent content={content} enableMath={enableMath} />,
      container
    );
  });
  return container;
}

function expectPlainText(root: HTMLElement, text: string) {
  expect(root.querySelector("del")).toBeNull();
  expect(root.textContent).toBe(text);
}

describe("MarkdownContent — GFM strikethrough", () => {
  it("keeps hyphenated month ranges as plain text", () => {
    expectPlainText(
      renderContent("1-3月的合计，以及4-12月的预测"),
      "1-3月的合计，以及4-12月的预测"
    );
  });

  it("keeps single-tilde numeric ranges as plain text", () => {
    expectPlainText(renderContent("25~30, 31~35"), "25~30, 31~35");
  });

  it("keeps single-tilde emphasis-like text as plain text", () => {
    expectPlainText(renderContent("~重要~"), "~重要~");
  });

  it("still renders standard double-tilde strikethrough", () => {
    const root = renderContent("~~已删除~~");
    const deleted = root.querySelector("del");
    expect(deleted).not.toBeNull();
    expect(deleted?.textContent).toBe("已删除");
  });

  it("keeps inline code and code block range text literal", () => {
    const root = renderContent(
      "`1-3月` `25~30` `~重要~`\n\n```\n1-3月\n25~30\n~重要~\n```"
    );
    expect(root.querySelector("del")).toBeNull();
    expect(
      Array.from(root.querySelectorAll("code")).map((code) => code.textContent)
    ).toEqual(["1-3月", "25~30", "~重要~", "1-3月\n25~30\n~重要~\n"]);
  });

  it("uses the same single-tilde rule when math rendering is enabled", () => {
    expectPlainText(renderContent("25~30, 31~35", true), "25~30, 31~35");
  });
});
