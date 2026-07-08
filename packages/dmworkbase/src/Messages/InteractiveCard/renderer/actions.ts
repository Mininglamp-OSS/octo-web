import { isSafeUrl } from "../../../Utils/security";

/**
 * Action.OpenUrl 导航。
 *
 * octo 卡片的动作由官方 AdaptiveCards SDK 解析并经 `onExecuteAction` 回调到 Cell；
 * Cell 对 OpenUrl 调用此函数在新标签打开。渲染期的动作白名单/整卡降级由
 * `validateCardForOcto` + SDK 受限 registry 负责，故这里只保留导航这一副作用。
 */

/** 在新标签打开 URL；提交前二次 isSafeUrl 校验（http/https），非法直接忽略。 */
export function openUrl(url: string): void {
  if (!isSafeUrl(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}
