// @vitest-environment jsdom

import React from "react";
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const { copyToClipboardMock, toastSuccessMock, toastWarningMock } = vi.hoisted(
  () => ({
    copyToClipboardMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastWarningMock: vi.fn(),
  })
);

vi.mock("../../../App", () => ({
  default: {
    dataSource: { commonDataSource: { getImageURL: (src: string) => src } },
  },
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../Utils/clipboard", () => ({
  copyToClipboard: copyToClipboardMock,
}));

vi.mock("@douyinfe/semi-ui/lib/es/toast", () => ({
  default: {
    success: toastSuccessMock,
    warning: toastWarningMock,
  },
}));

vi.mock("lucide-react", () => ({
  Copy: (props: any) => React.createElement("span", props),
}));

import MarkdownContent from "../MarkdownContent";
import type { ComponentProps } from "react";

let container: HTMLDivElement | null = null;

afterEach(() => {
  if (container) {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
    container = null;
  }
  copyToClipboardMock.mockReset();
  toastSuccessMock.mockReset();
  toastWarningMock.mockReset();
});

function renderContent(
  content: string,
  props: Partial<ComponentProps<typeof MarkdownContent>> = {}
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(
      <MarkdownContent content={content} {...props} />,
      container
    );
  });
  return container;
}

async function clickCopy(button: Element) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("MarkdownContent — code block copy", () => {
  it("renders a copy button for a fenced code block and preserves source whitespace", async () => {
    copyToClipboardMock.mockResolvedValue(true);
    const root = renderContent(
      "```ts\nconst value = 1;\n  console.log(value);\n```"
    );

    const button = root.querySelector(
      "button[aria-label='base.message.markdown.copyCode']"
    );
    expect(button).not.toBeNull();

    await clickCopy(button!);

    expect(copyToClipboardMock).toHaveBeenCalledWith(
      "const value = 1;\n  console.log(value);"
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "base.message.markdown.copyCodeSuccess"
    );
  });

  it("copies only the clicked code block when a message contains multiple blocks", async () => {
    copyToClipboardMock.mockResolvedValue(true);
    const root = renderContent("```js\nfirst();\n```\n\n```js\nsecond();\n```");

    const buttons = root.querySelectorAll(
      "button[aria-label='base.message.markdown.copyCode']"
    );
    expect(buttons).toHaveLength(2);

    await clickCopy(buttons[0]);

    expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
    expect(copyToClipboardMock).toHaveBeenCalledWith("first();");
  });

  it("keeps intentional blank lines but trims ReactMarkdown's synthetic trailing newline", async () => {
    copyToClipboardMock.mockResolvedValue(true);
    const root = renderContent("```\nline 1\n\nline 3\n```");
    const button = root.querySelector(
      "button[aria-label='base.message.markdown.copyCode']"
    );

    await clickCopy(button!);

    expect(copyToClipboardMock).toHaveBeenCalledWith("line 1\n\nline 3");
  });

  it("does not render a block copy button for inline code", () => {
    const root = renderContent("Use `inlineCode()` here.");

    expect(
      root.querySelector("button[aria-label='base.message.markdown.copyCode']")
    ).toBeNull();
  });

  it("does not render a copy button for streaming partial fenced code", () => {
    const root = renderContent("```ts\nconst partial = ", {
      isStreaming: true,
    });

    expect(root.querySelector("pre")).not.toBeNull();
    expect(
      root.querySelector("button[aria-label='base.message.markdown.copyCode']")
    ).toBeNull();
  });

  it("shows the existing copy failure warning when clipboard copy fails", async () => {
    copyToClipboardMock.mockResolvedValue(false);
    const root = renderContent("```\ncopy me\n```");
    const button = root.querySelector(
      "button[aria-label='base.message.markdown.copyCode']"
    );

    await clickCopy(button!);

    expect(toastWarningMock).toHaveBeenCalledWith(
      "base.module.contextMenus.copyFailed"
    );
  });
});
