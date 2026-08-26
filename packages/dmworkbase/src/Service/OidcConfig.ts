// OIDC provider 配置解析与卫生化。独立 leaf 文件, 不依赖 React / lottie 等重模块,
// 让 dmworklogin 的 vitest 可以直接深路径 import 真实实现做安全边界测试。

/**
 * OidcProviderConfig 与 dmworklogin 的 SSOProvider 字段一致, 在 base 这里独立定义
 * 是为了避免 base 反向依赖 login 包(login → base 是单向依赖)。
 * 后端 /v1/common/appconfig 的 oidc_providers 数组 entry 被 parse 成此结构。
 */
export interface OidcProviderConfig {
  id: string;
  name: string;
  authorizePath: string;
  accountUrl?: string;
  resetPasswordUrl?: string;
}

/**
 * 仅放行 http/https 协议的 URL, 防御 javascript:/data: 等协议的注入。
 * 后端配置接口受保护, 但作为深度防御, 所有用于 window.open / a[href] 的 URL 都需经过此校验。
 */
export function sanitizeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  try {
    const u = new URL(value);
    if (u.protocol === "https:" || u.protocol === "http:") return value;
  } catch {
    /* invalid URL */
  }
  return undefined;
}

/**
 * isSafeAuthorizePath 限定 authorize_path 必须是站内相对路径(以单个 / 开头, 不以 // 开头),
 * 且不能包含 URL 解析器会规范化的控制字符或查询/片段分隔符。
 *
 * 安全:authorize_path 会被前端拼进 window.location.href 触发跳转。
 * 浏览器对 location.href 赋 'javascript:' / 'data:' URL 会执行内容,赋 '//evil.com'
 * 会跳到第三方域,赋 'https://evil.com' 也是绕过 same-origin 的注入面。后端配置一旦
 * 被改坏(误填 / 被劫持) 都不应让前端把它当 URL 跳。所以此处只放行明确的服务端相对路径。
 */
function isSafeAuthorizePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

/**
 * parseOidcProviders 把后端 snake_case 的 provider 数组转成前端 camelCase。
 * 任何字段缺失/类型不对/不安全的 entry 被跳过, 不抛错——配置坏了应当退化为「无 SSO」
 * 而不是把整个 appconfig 接口拉崩。account_url / reset_password_url 走
 * sanitizeHttpUrl 防协议注入; authorize_path 走 isSafeAuthorizePath 限定为站内路径。
 */
export function parseOidcProviders(raw: unknown): OidcProviderConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: OidcProviderConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? (r["id"] as string) : "";
    const name = typeof r["name"] === "string" ? (r["name"] as string) : "";
    if (!id || !name) continue;
    if (!isSafeAuthorizePath(r["authorize_path"])) continue;
    out.push({
      id,
      name,
      authorizePath: r["authorize_path"] as string,
      accountUrl: sanitizeHttpUrl(r["account_url"]),
      resetPasswordUrl: sanitizeHttpUrl(r["reset_password_url"]),
    });
  }
  return out;
}
