// 受支持的运行时类型 —— 与 botsApi.SUPPORTED_RUNTIME_KINDS 一致(内联于此让本
// 模块零依赖、可被纯单测安全 import;botsApi 因 import App/i18n 带重副作用不宜引入)。
const SUPPORTED_RUNTIME_KINDS = ["openclaw", "claude"]

/**
 * 当前 space 是否存在至少一个「在线且受支持」的运行时 —— 决定能否创建 Bot。
 * 与 CreateBotModal 的提交条件(supported && status==="online")对齐:只有在线且
 * 类型受支持的运行时才能真正建 bot,否则菜单亮了点开弹窗也无可选项、是死胡同。
 */
export function canCreateBot(runtimes: { status: string; provider: string }[]): boolean {
    return runtimes.some((r) => r.status === "online" && SUPPORTED_RUNTIME_KINDS.includes(r.provider))
}
