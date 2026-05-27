import { describe, it, expect } from "vitest";
import { getExtension } from "../types";

/**
 * `getExtension(ext, name)` 边界测试。
 *
 * 背景 (issue #143 / PR #153):
 *   服务端返回的 `content.extension` 不可靠 — 实测 `.md` 文件该字段为空或
 *   是 "file" 等占位值, 导致前端 isMarkdown / FileRendererRegistry 都识别不到,
 *   最终走 FallbackRenderer 显示"暂不支持预览此文件类型"。
 *
 *   修复: 把优先级翻转 — 文件名后缀优先, content.extension 作为 fallback。
 *
 * 边界 (review 反复迭代得出):
 *   - dot > 0       : 排除前导点的 dotfile (如 .env), 它按 POSIX 没有扩展名,
 *                     该走 content.extension fallback。
 *   - dot < len - 1 : 排除尾部点 (如 "report."), 提取出来是空串, 也该 fallback。
 *
 * 注: 同一逻辑在 packages/dmworkbase/src/Messages/File/index.tsx 还有一份
 *     私有副本, 两边必须保持一致 (见函数注释)。
 */

describe("getExtension — 文件名后缀优先, extension 作为 fallback (#143)", () => {
    it("正常文件: 文件名后缀生效", () => {
        expect(getExtension("", "README.md")).toBe("md");
        expect(getExtension("", "report.pdf")).toBe("pdf");
        expect(getExtension("", "image.PNG")).toBe("png"); // 大小写归一
    });

    it("服务端返回错的 extension: 文件名后缀仍然胜出 (核心 bug 修复)", () => {
        // issue #143 复现: server 把 .md 的 extension 设成 "" 或 "file"
        expect(getExtension("", "README.md")).toBe("md");
        expect(getExtension("file", "README.md")).toBe("md");
        // 哪怕 server 给了不同的扩展名, 也以文件名为准
        expect(getExtension("txt", "report.pdf")).toBe("pdf");
    });

    it("无后缀文件 (Makefile / Dockerfile): fallback 到 extension", () => {
        expect(getExtension("txt", "Makefile")).toBe("txt");
        expect(getExtension("dockerfile", "Dockerfile")).toBe("dockerfile");
        expect(getExtension("", "Makefile")).toBe(""); // 都没有就空
    });

    it("尾部点 (report.): 后缀为空, fallback 到 extension", () => {
        expect(getExtension("pdf", "report.")).toBe("pdf");
        expect(getExtension("", "report.")).toBe("");
    });

    it("前导点的 dotfile (.env / .bashrc): fallback 到 extension", () => {
        // POSIX 语义下 .env 没有扩展名, 该走 fallback
        expect(getExtension("conf", ".env")).toBe("conf");
        expect(getExtension("txt", ".bashrc")).toBe("txt");
        expect(getExtension("", ".gitignore")).toBe("");
        expect(getExtension("", ".profile")).toBe("");
    });

    it("多重后缀 (archive.tar.gz): 取最后一个", () => {
        expect(getExtension("", "archive.tar.gz")).toBe("gz");
        expect(getExtension("", "report.pdf.bak")).toBe("bak");
    });

    it("name 缺失: fallback 到 extension", () => {
        expect(getExtension("pdf")).toBe("pdf");
        expect(getExtension("pdf", undefined)).toBe("pdf");
        expect(getExtension("pdf", "")).toBe("pdf");
    });

    it("两边都空: 返回空串", () => {
        expect(getExtension("")).toBe("");
        expect(getExtension("", "")).toBe("");
        expect(getExtension("", undefined)).toBe("");
    });

    it("extension 大小写归一", () => {
        expect(getExtension("PDF", "Makefile")).toBe("pdf");
        expect(getExtension("PNG")).toBe("png");
    });
});
