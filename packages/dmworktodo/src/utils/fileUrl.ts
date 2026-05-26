import { WKApp, isSafeUrl } from "@octo/base";

/**
 * Resolve a raw file_url and validate its protocol.
 *
 * 跟 dmworkbase Messages/File 的 getFileURL + isSafeUrl 保持一致的两步:
 *   1. WKApp.dataSource.commonDataSource.getFileURL(rawUrl)
 *      把后端可能给的相对路径 (/files/foo.pdf) 拼上 baseURL 变成绝对 URL,
 *      或者把 oss / cdn 路径拼上对应域名。
 *   2. 拿到的 URL 还可能不是 http(s):// 开头, 比如 ['/oss/...'] 这种,
 *      用 window.location.origin 拼一下兜底成绝对 URL。
 *   3. isSafeUrl 拒绝 javascript:/data:/file:/ftp: 等危险协议。
 *
 * 用在 OutputsPanel + MatterDetailPanel 时间线附件预览 / 下载, 避免代码漂移。
 *
 * @returns 解析+校验通过的绝对 URL, 不通过返回 null
 */
export function resolveAndGuardUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  let url = WKApp.dataSource.commonDataSource.getFileURL(rawUrl);
  if (url && !url.startsWith("http")) {
    url = window.location.origin + "/" + url.replace(/^\//, "");
  }
  if (!url || !isSafeUrl(url)) return null;
  return url;
}
