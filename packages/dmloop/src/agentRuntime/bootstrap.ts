// @octo/loop — Agent Runtime 鉴权接入
//
// 宿主（octo-web）启动时调用一次，把 Bearer token 的取值来源接到既有登录态上，
// 并注册 401 处理钩子。与既有 axios http.ts 的 token/X-Space-Id 头解耦：Agent Runtime
// 后端走 Bearer，token 复用同一登录态取值来源。

import { setAuthTokenProvider, setUnauthorizedHandler } from "../api/agentRuntime/httpClient";

// tokenProvider 由宿主注入（避免本包直接依赖 @octo/base 的登录态形状，便于单测）。
export function initAgentRuntimeAuth(opts: {
  getToken: () => string | null | undefined;
  onUnauthorized?: (path: string) => void;
}): void {
  setAuthTokenProvider(opts.getToken);
  if (opts.onUnauthorized) setUnauthorizedHandler(opts.onUnauthorized);
}
