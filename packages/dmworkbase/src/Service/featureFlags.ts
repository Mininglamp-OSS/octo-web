/**
 * 消息 reaction 功能开关。
 *
 * 服务端 reaction 契约已上线，生产默认开启。保留本地门控用于开发回归；若线上
 * 需要客户端降级，可发版把默认值切回 false。服务端权限、消息可见性和限流仍是
 * 最终安全边界。
 *
 * - dev / 分支预览：浏览器 console 执行
 *     localStorage.setItem('octo:ff:message-reaction', '1'); location.reload()
 *   设为 0/1 可显式关闭/开启。
 *
 * 沿用项目既有的「本地常量 + TODO」惯例（参见 Messages/Text/index.tsx 的 useNewUI）。
 */

const DEFAULT_ENABLED = true

const LOCAL_OVERRIDE_KEY = "octo:ff:message-reaction"

/** 整个 reaction 功能是否启用（展示 summary + 右键入口 + picker）。 */
export function isMessageReactionEnabled(): boolean {
  // localStorage 覆盖仅限开发构建；生产环境使用已上线服务对应的默认值。
  // try/catch：存储被禁用 / 分区（隐私模式、跨站隔离）时访问 localStorage 会抛
  // SecurityError；本函数在消息渲染与右键构建期间调用，抛出会弄挂聊天视图，故兜底。
  if (import.meta.env.DEV && typeof localStorage !== "undefined") {
    try {
      const v = localStorage.getItem(LOCAL_OVERRIDE_KEY)
      if (v === "1") return true
      if (v === "0") return false
    } catch {
      // 存储不可用，忽略本地覆盖，回落到默认值
    }
  }
  return DEFAULT_ENABLED
}
