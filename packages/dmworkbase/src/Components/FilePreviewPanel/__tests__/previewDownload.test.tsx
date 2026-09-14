// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("keeps explicit HTML action overrides authoritative", () => {
    const onDownload = vi.fn();
    const onOpenExternal = vi.fn();
    render(
      <FilePreviewHeader
        file={{
          url: "https://files.test/chat/a",
          name: "a.html",
          extension: "html",
        }}
        onClose={vi.fn()}
        showOpenExternal
        onDownload={onDownload}
        onOpenExternal={onOpenExternal}
      />
    );
    fireEvent.click(screen.getByTitle("base.filePreview.download"));
    fireEvent.click(screen.getByTitle("base.filePreview.openInNewTab"));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onOpenExternal).toHaveBeenCalledTimes(1);
    expect(mocks.downloadFile).not.toHaveBeenCalled();
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

  it("preserves the original XLSX filename for oversized spreadsheets", async () => {
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

    await waitFor(() =>
      expect(mocks.downloadFile).toHaveBeenCalledWith(
        xlsxFile.url,
        xlsxFile.name
      )
    );
  });

  it("preserves the filename when downloading an oversized code file", async () => {
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

    await waitFor(() =>
      expect(mocks.downloadFile).toHaveBeenCalledWith(
        "https://files.example.com/code-object-key",
        "large-source.ts"
      )
    );
  });
});
