import { describe, it, expect, vi } from "vitest";

// Mock 所有渲染器组件，避免 Semi UI 在 vitest 环境报错
vi.mock("../renderers/ExcelRenderer", () => ({ default: () => null }));
vi.mock("../renderers/PdfRenderer", () => ({ default: () => null }));
vi.mock("../renderers/MarkdownRenderer", () => ({ default: () => null }));
vi.mock("../renderers/CodeRenderer", () => ({ default: () => null }));
vi.mock("../renderers/TextRenderer", () => ({ default: () => null }));
vi.mock("../renderers/HtmlRenderer", () => ({ default: () => null }));
vi.mock("../renderers/FallbackRenderer", () => ({ default: () => null }));
vi.mock("../renderers/JsonRenderer", () => ({ default: () => null }));
vi.mock("../renderers/JsonlRenderer", () => ({ default: () => null }));
vi.mock("../renderers/ImageRenderer", () => ({ default: () => null }));
vi.mock("../renderers/VideoRenderer", () => ({ default: () => null }));

import fileRendererRegistry from "../registry";

/**
 * 注册映射测试 — 锁定 extension → renderer 的映射关系，防止回归。
 *
 * PR #570 恢复了 xlsx/xls/xlsb/xlsm 的 ExcelRenderer 注册，
 * 此测试确保这些扩展名正确解析到 ExcelRenderer，且 canPreview 返回 true。
 */

describe("fileRendererRegistry — 扩展名 → 渲染器映射", () => {
  it("Excel 格式全部映射到 excel type", () => {
    for (const ext of ["xlsx", "xls", "xlsb", "xlsm", "csv"]) {
      const item = fileRendererRegistry.getRenderer(ext);
      expect(item).toBeDefined();
      expect(item.type).toBe("excel");
    }
  });

  it("canPreview 对 Excel 格式返回 true", () => {
    for (const ext of ["xlsx", "xls", "xlsb", "xlsm", "csv"]) {
      expect(fileRendererRegistry.canPreview(ext)).toBe(true);
    }
  });

  it("大写扩展名也能正确解析", () => {
    expect(fileRendererRegistry.canPreview("XLSX")).toBe(true);
    expect(fileRendererRegistry.canPreview("XLS")).toBe(true);
  });

  it("非 Excel 格式映射到其他 type", () => {
    expect(fileRendererRegistry.getRenderer("pdf").type).toBe("pdf");
    expect(fileRendererRegistry.getRenderer("md").type).toBe("markdown");
  });

  it("不支持的格式 canPreview 返回 false", () => {
    expect(fileRendererRegistry.canPreview("docx")).toBe(false);
    expect(fileRendererRegistry.canPreview("pptx")).toBe(false);
    expect(fileRendererRegistry.canPreview("ppt")).toBe(false);
  });
});
