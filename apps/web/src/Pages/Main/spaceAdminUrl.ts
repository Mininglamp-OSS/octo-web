// 主站「空间管理」入口跳转 URL 的构造。
//
// 直接指向管理后台 SPA 的实际路径 `/admin/space`,而不是走 `/space` 短链 301——
// nginx 的 `return 301` 默认不会带上原始 query,`?spaceId=` 会在这一跳被丢掉;
// `/admin/space` 由 `/admin/` 的 try_files 直接落到 SPA index.html,浏览器 URL
// 上的 query 原样保留,SpaceEntry 里 `readRequestedSpaceId()` 才能读到。
//
// 带上当前 Space id 是为了让管理后台默认落到用户正在使用的空间,而不是可管理
// 列表里的第一个(用户可能同时管理多个空间)。currentSpaceId 缺失时回退到不带
// 参数的路径,后台按原有默认(当前 / 列表第一个)处理。
export function buildSpaceAdminUrl(currentSpaceId: string | undefined | null): string {
  if (!currentSpaceId) return '/admin/space'
  return `/admin/space?spaceId=${encodeURIComponent(currentSpaceId)}`
}
