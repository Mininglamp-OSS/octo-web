/**
 * 消息 reaction 功能开关。
 *
 * 现状（2026-07）：服务端 reaction 契约（写入 / 同步内联 / 单条查询 / CMD / 错误码）
 * 尚未确认落地，Web 侧写路径无法形成可上线闭环。为了让接线代码可以先合入分支、
 * 又不污染 main（避免用户看到 mock reaction、右键多出会报错的入口），整个 reaction
 * 入口由本开关 gate，默认关闭。
 *
 * - dev / 分支预览：浏览器 console 执行
 *     localStorage.setItem('octo:ff:message-reaction', '1'); location.reload()
 *   即可打开，看完整交互（数据走本地 mock store，刷新不持久、他人不可见）。
 * - 生产灰度：待服务端就绪后，把 DEFAULT_ENABLED 替换为读取 appconfig 字段
 *   （如 WKApp.remoteConfig.messageReactionEnabled），并移除 localStorage 覆盖。
 *
 * 沿用项目既有的「本地常量 + TODO」惯例（参见 Messages/Text/index.tsx 的 useNewUI）。
 */

const DEFAULT_ENABLED = false

const LOCAL_OVERRIDE_KEY = "octo:ff:message-reaction"

/** 整个 reaction 功能是否启用（展示 summary + 右键入口 + picker）。 */
export function isMessageReactionEnabled(): boolean {
  // localStorage 覆盖仅限开发构建：避免生产用户手动打开开关看到本地 mock 的
  // 伪造 reaction 数据。生产环境只认 DEFAULT_ENABLED（后续替换为 appconfig）。
  if (import.meta.env.DEV && typeof localStorage !== "undefined") {
    const v = localStorage.getItem(LOCAL_OVERRIDE_KEY)
    if (v === "1") return true
    if (v === "0") return false
  }
  return DEFAULT_ENABLED
}
