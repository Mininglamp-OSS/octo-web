import React from "react";
import { useI18n } from "./useI18n";
import { TranslationValues } from "./types";

export interface I18nTextProps {
  /** 翻译 key（含 `base.` 前缀，与 t() 一致） */
  k: string;
  /** 插值变量 */
  values?: TranslationValues;
}

/**
 * 响应式翻译文本组件。
 *
 * 用于「值在挂载后存活、需随语言切换实时更新」的位置——例如路由表头标题
 * （`RouteContextConfig.title` 在 push 时只存一次，若直接传 `t(key)` 字符串
 * 快照，切换语言后不会更新）。传 `<I18nText k="..." />` 则作为 i18n context
 * 消费者，locale 变化时自动重渲染。
 */
export function I18nText({ k, values }: I18nTextProps): JSX.Element {
  const { t } = useI18n();
  return <>{t(k, values ? { values } : undefined)}</>;
}

export default I18nText;
