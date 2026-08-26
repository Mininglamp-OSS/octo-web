// 纯函数场景判定：当前是否处于「独立文档专注场景」。
//
// 独立文档页（`/d/:docId`、`/ppt/d/:docId`）与 IM 聊天页共用同一套 SPA bundle：登录后同样
// 会连 IM、注册消息监听。文档=天然专注场景（对齐 Slack / Notion / 飞书文档），此时不应被 IM
// 桌面通知音 / 横幅打断，仅保留红点 / 未读数。通知的场景抑制以此判定为准。
//
// 只按路由 pathname 匹配、零依赖，便于单测直接导入；docId 段用与 `buildDocNavUrl` 一致的
// URL/path 安全白名单（`[A-Za-z0-9_-]{1,128}`），既挡住 `/d`、`/d/`、`/dashboard` 这类非文档
// 路径，也不把带 `../`/多段的畸形路径误判成文档场景。

/** `/d/:docId`（标准文档）。 */
const STANDALONE_DOC_PATH = /^\/d\/[A-Za-z0-9_-]{1,128}$/;
/** `/ppt/d/:docId`（幻灯片文档，独立命名空间）。 */
const STANDALONE_PPT_DOC_PATH = /^\/ppt\/d\/[A-Za-z0-9_-]{1,128}$/;

/** 是否为独立文档页路由（末尾斜杠归一，与 `normalizeRoutePath` 一致）。 */
export function isDocumentScenePath(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return (
    STANDALONE_DOC_PATH.test(normalized) ||
    STANDALONE_PPT_DOC_PATH.test(normalized)
  );
}

/**
 * 当前窗口是否处于文档专注场景。SSR / 测试环境下 `window` 缺失时返回 false（退化为「非文档
 * 场景」，即保持 IM 通知现状，fail-open 到既有行为而非误静音）。
 */
export function isDocumentFocusScene(): boolean {
  if (typeof window === "undefined" || !window.location) return false;
  return isDocumentScenePath(window.location.pathname);
}
