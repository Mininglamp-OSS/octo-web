// 主站「空间管理」入口跳转 URL 的构造。
//
// 带上当前 Space id 是为了让管理后台默认落到用户正在使用的空间,而不是可管理
// 列表里的第一个(用户可能同时管理多个空间)。currentSpaceId 缺失时回退到不带
// 参数的路径,后台按原有默认(当前 / 列表第一个)处理。
//
// 直接指向管理后台 SPA 的实际路径 `/admin/space`,而不是 `/space` 短链:这样
// query 不依赖任何一层重定向去转发它,少一跳,且在没有前置代理、直连 admin
// 容器的拓扑下同样成立 —— 那一层的 `location = /space` 用的是不带 args 的
// `return 301 /admin/space`,会把 `?spaceId=` 丢掉。
// (注:标准部署的前置 nginx 用 `return 301 /admin/space$1$is_args$args`,是会
//  保留 query 的,所以走短链在那个拓扑下也能工作 —— 直连路径只是更稳。)
// `/admin/` 由 try_files 落到 SPA index.html,浏览器 URL 上的 query 原样保留,
// SpaceEntry 的 `readRequestedSpaceId()` 才读得到。
export function buildSpaceAdminUrl(currentSpaceId: string | undefined | null): string {
  if (!currentSpaceId) return '/admin/space'
  return `/admin/space?spaceId=${encodeURIComponent(currentSpaceId)}`
}
