import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardMarkdown } from "./cardMarkdown";

/**
 * octo 受限 markdown → 安全 HTML 字符串。
 *
 * 用途：官方 AdaptiveCards SDK 的 `AdaptiveCard.onProcessMarkdown(text, result)` 钩子要求
 * 回填 **HTML 字符串**（`result.outputHtml`），而现有 `CardMarkdown` 产出的是 React 节点。
 * 这里用 `renderToStaticMarkup` 把同一个 `CardMarkdown` 组件渲成字符串——
 * **完全复用**已审计的安全面（react-markdown@8 + rehype-sanitize 白名单 + 链接二次
 * isSafeUrl 降级 + skipHtml + allowedElements），零新增依赖、零安全面漂移。
 *
 * Spike 发现 F1：SDK 未设 onProcessMarkdown 时含 markdown 的 TextBlock 正文渲染为空，
 * 故此函数是基础文本渲染的必需项，集成时必须恒设。
 */
export function cardMarkdownToSafeHtml(text: string): string {
  return renderToStaticMarkup(<CardMarkdown text={text} />);
}

export default cardMarkdownToSafeHtml;
