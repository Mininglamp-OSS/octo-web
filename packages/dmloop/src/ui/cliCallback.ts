// CLI add-computer 授权回调地址的安全校验。浏览器把刚签发的 CLI token 以 ?token= 拼到回调 URL 后
// 直接 window.location.href 跳转,所以这里是「token 送到哪」的唯一信任边界(#597 评审)。
// 独立成无 React/Semi 依赖的模块,便于单测锁死 accept/reject 行为。

// CLI 监听器与浏览器同机,只会绑在回环地址。放开整个 LAN/私网(10/172.16-31/192.168)会让 token
// 被重定向到同网段的其他主机,构成 token exfil。故只允许 loopback。
export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost") return true;
  // URL.hostname 对 IPv6 会保留方括号(如 "[::1]"),先剥离再比对——否则合法的 IPv6 回环被误拒。
  const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (bare === "::1" || bare === "::ffff:127.0.0.1") return true;
  // 整个 127.0.0.0/8 都是回环。
  const parts = bare.split(".");
  if (parts.length === 4) {
    const nums = parts.map((p) => Number(p));
    if (nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) && nums[0] === 127) return true;
  }
  return false;
}

export function isSafeCliCallback(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}
