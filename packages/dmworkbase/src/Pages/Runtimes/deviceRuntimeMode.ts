// 取 device 下所有 runtime 的 runtime_mode 去重结果(device 级展示):
//   - 0 个有效值 → "未知"
//   - 1 个唯一值 → 该值
//   - >1 个唯一值 → "混合"(混合部署 / 脏数据,不取 runtimes[0] 静默误显示)
// 空字符串 / null / undefined 的 runtime_mode 视为无效值,不计入去重集合。
//
// 独立无副作用文件:index.tsx 与单测都从这里 import,避免把页面模块的
// 顶层副作用(WKApp / Semi / CSS / BotsTab 等)拉进 vitest。
// i18n 也只从 instance 子模块取单例 t,绕开 i18n barrel 里 I18nProvider →
// @douyinfe/semi-ui → lottie-web(canvas)的重副作用链,保持本文件可被
// 纯单测安全 import。
import { t } from "../../i18n/instance"

export function deviceRuntimeMode(group: { runtimes: Array<{ runtime_mode?: string | null }> }): string {
    const modes = new Set<string>()
    for (const r of group.runtimes) {
        if (r.runtime_mode) modes.add(r.runtime_mode)
    }
    if (modes.size === 0) return t("base.runtimes.common.unknown")
    if (modes.size === 1) return modes.values().next().value as string
    return t("base.runtimes.mode.mixed")
}
