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
 * 不绑 origin，真预览 + 攻击者 url 可拼成可信钓鱼卡）。改为只用**已校验的 docId**拼相对路径
 * （同源、无 scheme，天然安全）；docId 非法则返回空串，调用方不导航/不显链接。
 *
 * Phase-1 取消 `sp`（设计 §5.3）：普通文档链接不再携带文档 Space——接收端的 open-context
 * 预检按 docId 在服务端解析文档归属，故这里只产出 `/d/{docId}`，不再拼 `?sp=`。
 */
export function buildDocNavUrl(docId: string): string {
  if (!isValidDocIdentifier(docId)) return "";
  return `/d/${encodeURIComponent(docId)}`;
}

// 类型仅用于签名，`import type` 在运行时被擦除，不会拉入 ui 组件的 React/CSS 加载链。
import type { DocSharePermissionState, DocSharePreviewStatus } from "../../ui/DocumentShareCard";

/**
 * 权限态只由接收者的实时 ACL 结果驱动。预览接口仅证明可访问，
 * 不返回真实角色，因此不能把消息 payload 中的授权意图当作当前权限。
 */
export function permissionState(status: DocSharePreviewStatus): DocSharePermissionState {
  if (status === "denied") return "no_access";
  if (status === "unavailable") return "unavailable";
  if (status === "error") return "error";
  if (status === "ready") return "reader";
  // empty = **reader-protected 接口确认了访问权，但没有可渲染内容**。它有两条来源，
  // 两条都在 requireDocRole(reader) **通过之后**才可能发生：
  //   • 409 `unsupported_doc_type`——doc_type 闸排在鉴权之后，拿到这个码即证明已过 reader
  //     校验（其它 409 到不了这里：归档的 `conflict` 走 unavailable、snapshot_invalid 等走
  //     error）。doc/sheet/board 端点会对 html 目标回它；/html-preview 自己也会对非 html
  //     目标回它——四个端点同一套语义，不用区分。
  //   • 200 + 空 preview（html 的 /html-preview 端点）——路由本身挂在 requireDocRole(reader)
  //     上，能返回 200 就说明鉴权已过；空内容是后端刻意的降级出口（无 slug / 上游超时 /
  //     抽不出正文时宁可回空也不回 5xx，见 htmlPreviewFetch.ts）。
  // 后端没有任何「无权限却返回 409 或 200」的路径，所以无论走哪条，empty 在 ACL 上都
  // **确证**了 reader 权限，标绿「可查看」是准确结论，不是乐观猜测；卡片随后自然落到
  // 「暂无预览」占位，而不是红色错误态。
  //
  // ⚠️ 注意区分：empty 对**权限**是稳定结论，但对**内容**不是——html 那条来源可能只是
  // 上游一次抖动，内容随时可能自愈（缓存语义见 preview.ts 的 fetchDocPreview）。
  // 这里只关心权限维度，所以两条来源殊途同归。
  if (status === "empty") return "reader";
  return "checking";
}
