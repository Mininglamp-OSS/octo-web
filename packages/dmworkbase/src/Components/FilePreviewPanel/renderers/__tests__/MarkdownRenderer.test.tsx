// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  content: "# title",
  loading: false,
  error: null as string | null,
  reload: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  markdownContent: vi.fn(({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  )),
}));

vi.mock("../../hooks/useFileContent", () => ({
  useFileContent: () => ({ ...state }),
}));

vi.mock("../../../../i18n", async () => {
  const ReactModule = await import("react");
  const translate = (key: string) => key;
  return {
    I18nContext: ReactModule.createContext({ t: translate }),
    t: translate,
    useI18n: () => ({ t: translate }),
  };
});

vi.mock("../../../Messages/Text/MarkdownContent", () => ({
  default: mocks.markdownContent,
}));

vi.mock("../../../../Messages/Text/MarkdownContent", () => ({
  default: mocks.markdownContent,
}));

vi.mock("../MarkdownSourceView", () => ({
  default: ({ content }: { content: string }) => (
    <pre data-testid="source">{content}</pre>
  ),
}));

vi.mock("../FileTooLarge", () => ({ default: () => <div>too-large</div> }));

vi.mock("../MarkdownToc", () => ({
  default: ({
    onToggle,
    onItemClick,
  }: {
    onToggle: () => void;
    onItemClick: (id: string) => void;
  }) => (
    <div data-testid="toc">
      <button onClick={onToggle}>toggle</button>
      <button onClick={() => onItemClick("one")}>one</button>
    </div>
  ),
  shouldShowToc: () => true,
  extractTocItems: (content: string) =>
    content
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line, index) => ({
        id: `id-${index}`,
        text: line.slice(3),
        level: 2,
      })),
}));

import MarkdownRenderer from "../MarkdownRenderer";

const file = {
  url: "https://files.example/readme.md",
  name: "readme.md",
  extension: "md",
  size: 100,
};

describe("MarkdownRenderer states and controls", () => {
  beforeEach(() => {
    state.content = "# title";
    state.loading = false;
    state.error = null;
    state.reload.mockReset();
    mocks.markdownContent.mockClear();
  });

  it("renders loading, error and empty states", () => {
    state.loading = true;
    const { rerender } = render(<MarkdownRenderer file={file} />);
    expect(screen.getByText("base.filePreview.loading")).toBeTruthy();

    state.loading = false;
    state.error = "failed";
    rerender(<MarkdownRenderer file={file} />);
    expect(screen.getByText("failed")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "base.filePreview.retry" })
    );
    expect(state.reload).toHaveBeenCalled();

    state.error = null;
    state.content = "  ";
    rerender(<MarkdownRenderer file={file} />);
    expect(screen.getByText("base.filePreview.empty")).toBeTruthy();
  });

  it("switches between preview/source and reports TOC availability", () => {
    state.content = "## One\n## Two\n## Three";
    const onMode = vi.fn();
    const onAvailable = vi.fn();

    render(
      <MarkdownRenderer
        file={file}
        onViewModeChange={onMode}
        onTocAvailableChange={onAvailable}
      />
    );

    expect(screen.getByTestId("markdown")).toBeTruthy();
    expect(onAvailable).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("toc")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(onMode).not.toHaveBeenCalled();
  });

  it("forces source mode for large markdown files", () => {
    state.content = "## One\n## Two\n## Three";

    render(<MarkdownRenderer file={{ ...file, size: 2 * 1024 * 1024 }} />);

    expect(screen.getByTestId("source")).toBeTruthy();
    expect(
      screen.getByText("base.filePreview.markdown.largeAutoSource")
    ).toBeTruthy();
  });

  it("keeps the document preview on the relaxed math pipeline", () => {
    state.content = "$a+b$";

    render(
      <MarkdownRenderer
        file={{
          url: "https://example.com/readme.md",
          name: "readme.md",
          extension: "md",
        }}
      />
    );

    expect(mocks.markdownContent.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        content: "$a+b$",
        enableMath: true,
        allowSingleDollarMath: true,
      })
    );
  });
});
