// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
}));

vi.mock("../../../Utils/download", () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock("../../../Utils/fileIcon", () => ({
  getFileIcon: () => "/file.svg",
}));

vi.mock("../../../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../i18n")>();
  return {
    ...actual,
    useI18n: () => ({ t: (key: string) => key }),
  };
});

vi.mock("../registry", () => ({
  fileRendererRegistry: {
    getRenderer: () => ({ renderer: () => null }),
    canPreview: () => true,
  },
}));

vi.mock("../renderers", () => ({}));

import FilePreviewPanel from "../index";
import FilePreviewHeader from "../FilePreviewHeader";
import CodeRendererBase from "../renderers/CodeRendererBase";
import FallbackRenderer from "../renderers/FallbackRenderer";
import FileTooLarge from "../renderers/FileTooLarge";

const pptxFile = {
  url: "https://files.example.com/random-object-key",
  name: "quarterly-report.pptx",
  extension: "pptx",
};

const xlsxFile = {
  url: "https://files.example.com/another-random-key",
  name: "budget.xlsx",
  extension: "xlsx",
};

describe("file preview downloads", () => {
  beforeEach(() => {
    mocks.downloadFile.mockReset();
    mocks.downloadFile.mockResolvedValue(undefined);
  });

  it("preserves the original filename from the conversation preview header", () => {
    render(<FilePreviewHeader file={pptxFile} onClose={vi.fn()} />);

    fireEvent.click(screen.getByTitle("base.filePreview.download"));

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      pptxFile.url,
      pptxFile.name
    );
  });

  it("preserves the original filename from the standalone preview panel", () => {
    render(
      <FilePreviewPanel
        file={xlsxFile}
        onClose={vi.fn()}
        showOpenExternal={false}
      />
    );

    fireEvent.click(screen.getByTitle("base.filePreview.download"));

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      xlsxFile.url,
      xlsxFile.name
    );
  });

  it("preserves the original PPTX filename from the fallback renderer", () => {
    render(<FallbackRenderer file={pptxFile} />);

    fireEvent.click(
      screen.getByRole("button", { name: "base.filePreview.download" })
    );

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      pptxFile.url,
      pptxFile.name
    );
  });

  it("preserves the original XLSX filename for oversized spreadsheets", () => {
    render(
      <FileTooLarge
        fileName={xlsxFile.name}
        fileSize={30 * 1024 * 1024}
        fileUrl={xlsxFile.url}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "base.filePreview.downloadFile" })
    );

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      xlsxFile.url,
      xlsxFile.name
    );
  });

  it("preserves the filename when downloading an oversized code file", () => {
    render(
      <CodeRendererBase
        file={{
          url: "https://files.example.com/code-object-key",
          name: "large-source.ts",
          extension: "ts",
        }}
        renderMode="too-large"
        formattedContent=""
        language="typescript"
        loading={false}
        error={null}
        onReload={vi.fn()}
        fileSize={30 * 1024 * 1024}
        contentSize={0}
      />
    );

    fireEvent.click(
      screen.getByRole("button", { name: "base.filePreview.downloadFile" })
    );

    expect(mocks.downloadFile).toHaveBeenCalledWith(
      "https://files.example.com/code-object-key",
      "large-source.ts"
    );
  });
});
