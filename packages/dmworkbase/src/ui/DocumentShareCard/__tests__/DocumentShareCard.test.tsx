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
  it.each(["reader", "writer", "no_access", "checking"] as const)(
    "%s 状态预览区可点（非死按钮）",
    (state) => {
      const html = renderToStaticMarkup(
        <DocumentShareCard
          {...baseProps({
            state,
            preview: state === "reader" || state === "writer" ? baseProps().preview : undefined,
            placeholder:
              state === "no_access"
                ? { icon: "lock", title: "需要访问权限", desc: "打开文档后可以申请访问" }
                : state === "checking"
                  ? { icon: "info", title: "正在确认访问权限…" }
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
