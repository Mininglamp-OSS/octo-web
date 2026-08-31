import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
import { DocumentShareCard, type DocumentShareCardProps, type DocumentShareCardStrings } from "../index";

/**
 * dmwork-web#1008 — 转发分享卡片主操作（预览区可点开文档）disabled 门控回归。
 *
 * 背景（reviewer Jerry-Xin / yujiawei blocking）：no_access（403）宣传"申请访问"，
 * 按钮却被 disabled → 死按钮，接收者无法从卡片走到申请入口。修法：只有 unavailable
 * （文档失效 404/410，导航无意义）禁用；no_access 保持可点，点击经 buildDocNavUrl
 * 导航到 /d/:docId 触发文档侧申请流程。这组断言把"哪些 state 禁用"钉死。
 */

const strings = (over: Partial<DocumentShareCardStrings> = {}): DocumentShareCardStrings => ({
  subtitle: "Sophie 创建",
  permissionLabel: "可查看",
  copyLabel: "复制链接",
  openLabel: "打开文档",
  ...over,
});

function baseProps(over: Partial<DocumentShareCardProps> = {}): DocumentShareCardProps {
  return {
    kind: "doc",
    title: "示例文档",
    state: "reader",
    strings: strings(),
    preview: { type: "doc", heading: "标题", paragraphs: ["正文"] },
    onOpen: vi.fn(),
    onCopy: vi.fn(),
    ...over,
  };
}

/** 预览区按钮是否禁用（renderToStaticMarkup 下 disabled 属性只出现在被禁用的 button 上）。 */
function previewButtonDisabled(html: string): boolean {
  const m = html.match(/class="document-forward-preview"[^>]*/);
  return m ? m[0].includes("disabled") : /document-forward-preview[^>]*disabled/.test(html);
}

describe("DocumentShareCard — 预览区主操作 disabled 门控", () => {
  it.each(["reader", "commenter", "writer", "no_access", "error", "checking"] as const)(
    "%s 状态预览区可点（非死按钮）",
    (state) => {
      const html = renderToStaticMarkup(
        <DocumentShareCard
          {...baseProps({
            state,
            preview: state === "reader" || state === "commenter" || state === "writer" ? baseProps().preview : undefined,
            placeholder:
              state === "no_access"
                ? { icon: "lock", title: "需要访问权限", desc: "打开文档后可以申请访问" }
                : state === "checking"
                  ? { icon: "info", title: "正在确认访问权限…" }
                  : state === "error"
                    ? { icon: "warning", title: "预览暂时不可用" }
                  : undefined,
          })}
        />,
      );
      expect(previewButtonDisabled(html)).toBe(false);
    },
  );

  it("unavailable 状态预览区禁用（文档失效，导航无意义）", () => {
    const html = renderToStaticMarkup(
      <DocumentShareCard
        {...baseProps({
          state: "unavailable",
          preview: undefined,
          strings: strings({ permissionLabel: "不可用" }),
          placeholder: { icon: "warning", title: "文档不可用", desc: "该文档可能已被删除或归档" },
        })}
      />,
    );
    expect(previewButtonDisabled(html)).toBe(true);
  });

  it("有权限时渲染首屏预览内容而非占位", () => {
    const html = renderToStaticMarkup(<DocumentShareCard {...baseProps({ state: "reader" })} />);
    expect(html).toContain("document-preview-page");
    expect(html).not.toContain("document-preview-placeholder");
  });

  it("无权限时渲染占位而非预览内容", () => {
    const html = renderToStaticMarkup(
      <DocumentShareCard
        {...baseProps({
          state: "no_access",
          preview: undefined,
          placeholder: { icon: "lock", title: "需要访问权限" },
        })}
      />,
    );
    expect(html).toContain("document-preview-placeholder");
    expect(html).toContain("需要访问权限");
  });
});

/** 提取类型图标的 svg markup（用于区分不同 kind 的图形）。 */
function typeIconMarkup(html: string): string {
  const m = html.match(/<span class="document-forward-type-icon"[^>]*>([\s\S]*?)<\/span>/);
  return m ? m[1] : "";
}

describe("DocumentShareCard — kind=html", () => {
  // html 文档转发：有 reader 权限但该类型无预览（409 → empty → reader + 「暂无预览」占位）。
  // 卡片必须能渲染、不能因未知 kind 崩溃，且类型图标仍在。
  it("kind='html' 渲染不崩，类型图标存在", () => {
    const html = renderToStaticMarkup(
      <DocumentShareCard
        {...baseProps({
          kind: "html",
          title: "周报.html",
          state: "reader",
          preview: undefined,
          strings: strings({ permissionLabel: "可查看" }),
          placeholder: { icon: "info", title: "暂无预览" },
        })}
      />,
    );
    expect(html).toContain("document-forward-type-icon");
    expect(html).toContain("<svg");
    expect(html).toContain("周报.html");
    // empty → reader → 绿色基调，绝不能是红色 error 基调。
    expect(html).toContain("document-forward-card is-success");
    expect(html).toContain("暂无预览");
  });

  // html 有自己的图标，不能 fall-through 到默认 doc 图标（否则用户分不出这是 HTML 文档）。
  it("kind='html' 的类型图标与 doc 不同", () => {
    const render = (kind: DocumentShareCardProps["kind"]): string =>
      renderToStaticMarkup(
        <DocumentShareCard
          {...baseProps({ kind, preview: undefined, placeholder: { icon: "info", title: "暂无预览" } })}
        />,
      );
    const htmlIcon = typeIconMarkup(render("html"));
    expect(htmlIcon).not.toBe("");
    expect(htmlIcon).not.toBe(typeIconMarkup(render("doc")));
    expect(htmlIcon).not.toBe(typeIconMarkup(render("board")));
    expect(htmlIcon).not.toBe(typeIconMarkup(render("sheet")));
  });

  it("kind='html' 预览区仍可点（可打开文档）", () => {
    const html = renderToStaticMarkup(
      <DocumentShareCard
        {...baseProps({
          kind: "html",
          state: "reader",
          preview: undefined,
          placeholder: { icon: "info", title: "暂无预览" },
        })}
      />,
    );
    expect(previewButtonDisabled(html)).toBe(false);
  });
});
