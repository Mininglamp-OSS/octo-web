// @vitest-environment jsdom
import React from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markdownContent: vi.fn(() => null),
  reload: vi.fn(),
}));

vi.mock("../../../../Messages/Text/MarkdownContent", () => ({
  default: mocks.markdownContent,
}));

vi.mock("../../hooks/useFileContent", () => ({
  useFileContent: () => ({
    content: "$a+b$",
    loading: false,
    error: null,
    reload: mocks.reload,
  }),
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

vi.mock("../MarkdownSourceView", () => ({ default: () => null }));
vi.mock("../FileTooLarge", () => ({ default: () => null }));

vi.mock("../MarkdownToc", () => ({
  default: () => null,
  shouldShowToc: () => false,
  extractTocItems: () => [],
}));

import MarkdownRenderer from "../MarkdownRenderer";

describe("MarkdownRenderer math mode", () => {
  beforeEach(() => {
    mocks.markdownContent.mockClear();
  });

  it("keeps the document preview on the relaxed math pipeline", () => {
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
