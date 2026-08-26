// IdP「去认证」入口 URL 解析器。独立 leaf 文件不依赖 React / lottie / wukongimjssdk
// 等重模块, 让 vitest 可以直接深路径 import 做边界单测（不被 MeInfo vm.tsx 的
// 一堆副作用 import 拖下水）。
//
// 业务背景（GH #1174）：
//   Phase 2a/2b/2c 三端 PR 曾把 IdP verification URL 硬编码成 prod 域，导致
//   测试环境跳错地址。
//
//   后端早已按环境下发了正确域名：`/v1/common/appconfig` 的
//   `oidc_providers[].account_url` 字段。Web 端 NavSettingsPanel「账户中心」入口
//   已经在走这条链, 是前端既有正路。这里把「去认证」入口也迁到同一条链上。
//
// Phase 2e 闭环追加：
//   必须把本站的 return_to 回跳 URL 一并拼进 query,否则用户在 IdP 实名完成后
//   会卡在 IdP 页回不来,整个实名链路在 UX 上断掉。return_to 通过 query 参数
//   `return_to=<encoded>` 传给 IdP,IdP 完成后 302 回本站 `?verified=1`,由
//   MeInfoVM.didMount 的 ?verified=1 handler + 全局 useRealnameVerifiedLandingHandler
//   触发 reloadSelfProfile 闭环(pull-from-idp 已废弃, 实名同步改走
//   dmworkim sync_worker 15min 轮询)。

import type { OidcProviderConfig } from "../../Service/OidcConfig";

/** 固定 fragment / query 锚点, 定向到 IdP 账户页里的「实名认证」section。 */
const VERIFY_ANCHOR_PATH = "/profile/info?anchor=verification";

export type ResolveRealnameVerifyUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: "no_login_provider" | "local_account" | "no_account_url" };

/**
 * 按登录用户的 OIDC provider id 在后端下发的 oidc_providers 里找对应 account_url,
 * 拼成 IdP 实名认证入口 URL。
 *
 * 行为合约（覆盖四个分支 + return_to 闭环）:
 *   1. provider 配了 account_url  → ok + 拼好的 URL（带 return_to）
 *   2. provider 无 account_url     → no_account_url（前端应 toast 不跳）
 *   3. loginProvider 是 local / 空 → local_account / no_login_provider（不跳转）
 *   4. provider id 不在 oidcProviders 里 → no_account_url（不跳转）
 *
 * 绝不引入 prod 域常量 / 测试域常量兜底 —— 这是本函数存在的唯一理由:
 * 让「去认证」的环境感知 100% 走后端 appconfig 下发, 与 NavSettingsPanel
 * 「账户中心」入口口径统一。
 *
 * accountUrl 末尾斜杠去重（`replace(/\/+$/,'')`）是为了防 backend 下发
 * 带尾斜杠的账号中心地址导致最终拼出 `//profile/info?...` 这种
 * 协议相对 URL（浏览器会当 `https://profile/...` 的站点跳）。
 *
 * returnTo:必传非空字符串,会 `encodeURIComponent` 后拼在 query 末尾。
 * 经典值:`${window.location.origin}${window.location.pathname}?verified=1`,
 * 让 IdP 实名完成后 302 回本站 MeInfo 页并触发 ?verified=1 handler。
 *
 * 空串 / null / undefined 被视作编程错误(调用方永远应当提供明确回跳地址,
 * 否则用户在 IdP 实名完成后回不到本站, 整条闭环断)。Jerry R3
 * 明确要求在此处显式 throw 而不是静默 `?? ""` 拼空值 —— 后者会导致
 * `return_to=` 被 IdP 误当作空 query 继续 302 回 prod 默认页,现场没日志
 * 可追。改为 throw 让 bug 在调用方本地就暴露。
 */
export function resolveRealnameVerifyUrl(
  loginProvider: string | undefined | null,
  oidcProviders: readonly OidcProviderConfig[] | undefined | null,
  returnTo: string,
): ResolveRealnameVerifyUrlResult {
  // returnTo 合约前置校验 —— 空值直接 throw, 不走静默降级。
  if (typeof returnTo !== "string" || returnTo.length === 0) {
    throw new Error(
      "resolveRealnameVerifyUrl: returnTo is required (non-empty string). " +
        "A missing return_to breaks the IdP verification round-trip.",
    );
  }
  if (typeof loginProvider !== "string" || loginProvider.length === 0) {
    return { ok: false, reason: "no_login_provider" };
  }
  if (loginProvider === "local") {
    return { ok: false, reason: "local_account" };
  }
  const providers = Array.isArray(oidcProviders) ? oidcProviders : [];
  const provider = providers.find((p) => p && p.id === loginProvider);
  const accountUrl = provider?.accountUrl;
  if (typeof accountUrl !== "string" || accountUrl.length === 0) {
    return { ok: false, reason: "no_account_url" };
  }
  const base = accountUrl.replace(/\/+$/, "");
  const url = `${base}${VERIFY_ANCHOR_PATH}&return_to=${encodeURIComponent(returnTo)}`;
  return { ok: true, url };
}
