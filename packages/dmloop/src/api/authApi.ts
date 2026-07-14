import { httpGet, httpPost } from "./http";

export function issueLoopCliToken(): Promise<{ token: string }> {
  return httpPost<{ token: string }>("/cli-token");
}

// headless 免浏览器接入:后端当场为当前用户签一个 90 天 PAT,
// 供 headless 环境用 `login --token` 直接认证。
export function issueHeadlessCliToken(): Promise<{ token: string }> {
  return httpPost<{ token: string }>("/cli-token/headless");
}

// 取后端公开地址(daemon_server_url,由后端配置下发)。
// headless 命令的 --server-url 用它,直连后端,避开 web 代理歧义。
export function getDaemonServerUrl(): Promise<string> {
  return httpGet<{ daemon_server_url?: string }>("/config").then(
    (c) => c.daemon_server_url?.trim() ?? "",
  );
}
