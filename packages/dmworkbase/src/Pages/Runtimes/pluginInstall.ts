// 1a 只支持 openclaw 的 octo 适配插件一键安装(cc-octo 的安装留待后续,需用户提供
// LLM 网关/key 等额外配置)。当 provider 是 openclaw 且其 octo 插件尚未安装时,版本
// 槽显示「安装」。
export function canInstallOctoPlugin(provider: string, hasOctoPlugin: boolean): boolean {
    return provider === "openclaw" && !hasOctoPlugin
}

// 安装完成判定:刷新到的 runtime.metadata(JSON 字符串)的 plugins 列表里是否已出现
// 该适配插件。install 复用 upgrade 的轮询,但**完成条件**不能沿用升级的
// `!has_plugin_update`(首装时该 hint 一开始就是 false/undefined,会让确认循环在
// daemon 还没重报新插件前就 remount,导致「安装」按钮闪回)。install 必须等插件真正
// 出现在 metadata 里才算落地。
export function octoPluginInstalled(metadataJson: string | undefined, component: string | undefined): boolean {
    if (!component) return false
    try {
        const meta = JSON.parse(metadataJson || "{}")
        return Array.isArray(meta?.plugins) && meta.plugins.some((p: { name?: string }) => p?.name === component)
    } catch {
        return false
    }
}

// cc 适配插件(cc-channel-octo)一键安装:provider 是 claude 且其 cc-octo 插件
// 尚未安装时,版本槽显示「安装」。与 canInstallOctoPlugin 对称,但 cc 安装需用户
// 提供 LLM 网关 url + key(走 CcInstallModal 收集),故走不同的提交路径。
export function canInstallCcPlugin(provider: string, hasCcOctoPlugin: boolean): boolean {
    return provider === "claude" && !hasCcOctoPlugin
}

/**
 * 判定是否应显示 cc-octo 安装按钮。纯函数，供渲染和测试共用。
 * 条件：canInstallCcPlugin 为真 AND backend 有可安装的版本 (plugin_install_version 非空)。
 */
export function shouldShowCcInstall(provider: string, hasCcOctoPlugin: boolean, pluginInstallVersion?: string): boolean {
    return canInstallCcPlugin(provider, hasCcOctoPlugin) && !!pluginInstallVersion
}
