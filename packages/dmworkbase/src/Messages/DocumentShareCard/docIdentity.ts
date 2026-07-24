// 纯粹的 docId/spaceId 安全原语——零外部依赖（不引 i18n/wukongimjssdk），
// 便于单测直接导入而不触发 semi-ui/i18n 的模块加载链。
//
// type-18 文档转发卡无发送者信任门、payload 全来自 wire，故 docId/spaceId 必须当
// **不可信输入**处理：解码边界白名单校验、导航 URL 本地重建（不信任 wire url）。

/** docId / spaceId 白名单：只允许 URL/path 安全字符，挡 `../`、`/`、scheme、空白、超长。 */
const DOC_IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** 是否为合法 docId/spaceId。 */
export function isValidDocIdentifier(v: unknown): v is string {
  return typeof v === "string" && DOC_IDENTIFIER_RE.test(v);
}

/** 合法则原样返回，否则空串（用于解码边界收窄）。 */
export function asDocIdentifier(v: unknown): string {
  return isValidDocIdentifier(v) ? v : "";
}

/**
 * 本地重建的**安全导航 URL**。P1-b：绝不信任 wire 传来的 `url`（`isSafeUrl` 只挡 scheme
 * 不绑 origin，真预览 + 攻击者 url 可拼成可信钓鱼卡）。改为只用**已校验的 docId/spaceId**
 * 拼相对路径（同源、无 scheme，天然安全）；docId 非法则返回空串，调用方不导航/不显链接。
 */
export function buildDocNavUrl(docId: string, spaceId: string): string {
  if (!isValidDocIdentifier(docId)) return "";
  const sp = isValidDocIdentifier(spaceId) ? `?sp=${encodeURIComponent(spaceId)}` : "";
  return `/d/${encodeURIComponent(docId)}${sp}`;
}

// 类型仅用于签名，`import type` 在运行时被擦除，不会拉入 ui 组件的 React/CSS 加载链。
import type { DocSharePermissionState, DocSharePreviewStatus } from "../../ui/DocumentShareCard";

/**
 * 权限态推导：**只由接收者本人的实时 ACL 取数结果驱动**——
 *   - denied → no_access（需申请）；unavailable → unavailable（不可用）；
 *   - ready（ACL 确认可访问）→ reader（可查看）；
 *   - loading / error（尚未确认）→ checking（中性，绝不宣称"可查看/已授予"）。
 * 硬化「中和展示态声明」：不采信 payload 里的 `permission`（wire 声明可伪造）；未确认前保守显示。
 */
export function permissionState(status: DocSharePreviewStatus): DocSharePermissionState {
  if (status === "denied") return "no_access";
  if (status === "unavailable") return "unavailable";
  if (status === "ready") return "reader";
  return "checking";
}
