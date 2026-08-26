/**
 * 「转为在线文档」失败原因 → 可展示文案（octo-smart-summary#195 / PR1447 后续）。
 *
 * 为什么需要这一层：
 *
 * docs-backend 的导入接口用 `{ "error": "<code>" }` 表达失败原因（schema_incompatible /
 * doc_too_large / base_version_stale …），而 host 的 `normalizeApiError` 只识别
 * 401/403/404/429/5xx 这几类通用状态，其余一律落到 `t("base.api.error.unknown")`
 * ——「未知错误」。于是 `extractErrorMsg(err)` 返回的是一个**非空**的「未知错误」，
 * 调用方 `extractErrorMsg(err) || t("summary.detail.convertFailed")` 里 `||` 右边
 * 永远不会执行，专门写的 convertFailed 文案实际上是死文案。
 *
 * 后果不只是「文案不好看」：这些错误**全是确定性的**（同一份 markdown 重试多少次都是
 * 同一个 422），而「未知错误」既没说明原因、也没给出正确动作，用户只会反复点击。真实
 * 案例见 2026-08-26：正文里一句 `**还没有 `summary` 命令**` 触发 422
 * schema_incompatible，从 UI 上完全看不出和那句话有关。
 *
 * 错误码是拿得到的：docs 模块的 `toApiErrorEnvelope` 会把原始 axios 错误的
 * `{ status, data }` 提升到 `err.response`，所以 `err.response.data.error` 一路都在，
 * 只是此前没有人读它。本模块负责读出来并翻译。
 *
 * 匹配顺序：先按后端错误码精确匹配（信息量最大），再退化到 HTTP 状态码（后端换了新码
 * 时至少还能说对大类），最后才回到 `convertFailed` 通用文案。
 */

/** docs-backend 导入/写入路径会返回的错误码 → i18n key（相对 `summary.detail.`）。 */
const ERROR_CODE_MESSAGE_KEYS: Record<string, string> = {
    // 正文里有当前文档 schema 不接受的结构。最典型的是行内代码和 加粗/斜体/链接 叠加
    // （schema 里 code 声明了 excludes:'_'）。
    schema_incompatible: "summary.detail.convertErrSchema",
    // 解析阶段就失败（畸形 markdown / 不可解析的内容）。
    import_failed: "summary.detail.convertErrParse",
    // 正文超出单篇文档上限。
    doc_too_large: "summary.detail.convertErrTooLarge",
    // 引用了当前文档里不存在的附件。
    attachment_not_found: "summary.detail.convertErrAttachment",
    // 并发写入导致的基线/锚点冲突：文档在导入过程中被改了。
    base_version_stale: "summary.detail.convertErrStale",
    anchor_not_found: "summary.detail.convertErrStale",
    anchor_mismatch: "summary.detail.convertErrStale",
    // 权限版本变了（被移出协作者 / 角色被降级）。
    epoch_changed: "summary.detail.convertErrPermission",
    forbidden: "summary.detail.convertErrPermission",
    // 上传内容为空 / 非法 UTF-8：正常路径不该出现，兜住以免又掉回「未知错误」。
    empty_upload: "summary.detail.convertErrEmpty",
    invalid_utf8: "summary.detail.convertErrEncoding",
    // 目标文档类型不支持正文导入（board/sheet/whiteboard）。
    unsupported_doc_type: "summary.detail.convertErrDocType",
};

/** 后端换了新错误码时的兜底：HTTP 状态码 → i18n key。 */
const HTTP_STATUS_MESSAGE_KEYS: Record<number, string> = {
    403: "summary.detail.convertErrPermission",
    404: "summary.detail.convertErrNotFound",
    409: "summary.detail.convertErrPermission",
    412: "summary.detail.convertErrStale",
    413: "summary.detail.convertErrTooLarge",
    422: "summary.detail.convertErrParse",
    429: "summary.detail.convertErrBusy",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 从错误对象里取出 docs-backend 的错误码。
 *
 * 只认 `response.data.error` 是字符串的情形。后端有另一种 `{ error: { code, message } }`
 * 的 v2 信封（由 host 的 normalizeApiError 负责），那种形状这里刻意不处理：错判成错误码
 * 会翻译出一句和事实无关的文案，比诚实地退回通用文案更糟。
 */
export function extractConvertDocErrorCode(err: unknown): string | undefined {
    if (!isRecord(err)) return undefined;
    const response = err.response;
    if (!isRecord(response)) return undefined;
    const data = response.data;
    if (!isRecord(data)) return undefined;
    const code = data.error;
    if (typeof code !== "string") return undefined;
    const trimmed = code.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/** 从错误对象里取出 HTTP 状态码（`response.status` 优先，其次 host 归一化的 `status`）。 */
function extractHttpStatus(err: unknown): number | undefined {
    if (!isRecord(err)) return undefined;
    const response = err.response;
    if (isRecord(response) && typeof response.status === "number") return response.status;
    if (typeof err.status === "number") return err.status;
    return undefined;
}

/**
 * 解析出该展示给用户的 i18n key；无法判定时返回 undefined，由调用方回落到通用文案。
 *
 * 拆成「返回 key」而不是「返回已翻译的字符串」，是为了让调用方沿用自己的 `t`
 * （SummaryDetailPage 用的是 context 上的 t，不是模块级单例）。
 */
export function resolveConvertDocErrorKey(err: unknown): string | undefined {
    const code = extractConvertDocErrorCode(err);
    if (code && ERROR_CODE_MESSAGE_KEYS[code]) return ERROR_CODE_MESSAGE_KEYS[code];
    const status = extractHttpStatus(err);
    if (status !== undefined && HTTP_STATUS_MESSAGE_KEYS[status]) {
        return HTTP_STATUS_MESSAGE_KEYS[status];
    }
    return undefined;
}

/**
 * 「转文档」失败时的最终展示文案。
 *
 * 刻意**不**复用 `extractErrorMsg(err)`：它对这些错误返回的是 host 归一化后的
 * 「未知错误」——一个非空字符串，会把所有更具体的判断都短路掉（这正是本模块要修的
 * 缺陷）。只有当我们既认不出错误码、也认不出状态码时，才退回 `convertFailed`。
 */
export function convertDocErrorMessage(err: unknown, t: (key: string) => string): string {
    const key = resolveConvertDocErrorKey(err);
    return t(key ?? "summary.detail.convertFailed");
}
