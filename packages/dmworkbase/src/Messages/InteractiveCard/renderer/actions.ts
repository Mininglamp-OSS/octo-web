import WKApp from "../../../App";
import { isSafeUrl } from "../../../Utils/security";
import { tryOpenDocLinkInSidebar } from "../../../Utils/docLinkNavigation";

const SUMMARY_DETAIL_PATH_RE = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

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

  // isSafeUrl 已保证 http/https 绝对 URL（new URL 不会抛）；try 兼容未来 isSafeUrl 放宽相对路径的情况。
  let summaryTaskNo: string | null = null;
  let summarySpace: string | undefined;
  try {
    const u = new URL(url);
    summaryTaskNo = u.pathname.match(SUMMARY_DETAIL_PATH_RE)?.[1] ?? null;
    // 深链带的空间（sp||space）随任务号一起透传，避免跨空间详情解析到当前空间→404。
    summarySpace = u.searchParams.get("sp") || u.searchParams.get("space") || undefined;
  } catch {
    summaryTaskNo = null;
  }
  if (summaryTaskNo && WKApp.openSummaryDetail) {
    // 卡片深链可能来自 https 生产域，本地调试是 http/端口；/s/<taskNo> 路径本身是内部详情信号。
    WKApp.openSummaryDetail(summaryTaskNo, summarySpace);
    return;
  }

  // WS-17: 卡片里的文档链接 `/d/<docId>?sp=` 在聊天内点击时，走侧边栏内联打开（仅当聊天侧边栏宿主已挂载）；
  // 其余情况回退到新标签打开整页，与总结 `/s/` 深链的处理对称。
  if (tryOpenDocLinkInSidebar(url)) {
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (!document.execCommand("copy")) {
      throw new Error("execCommand copy failed");
    }
  } finally {
    textarea.remove();
  }
}
