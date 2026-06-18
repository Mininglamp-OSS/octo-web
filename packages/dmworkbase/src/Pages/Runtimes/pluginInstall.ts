// 1a 只支持 openclaw 的 octo 适配插件一键安装(cc-octo 的安装留待后续,需用户提供
// LLM 网关/key 等额外配置)。当 provider 是 openclaw 且其 octo 插件尚未安装时,版本
// 槽显示「安装」。
export function canInstallOctoPlugin(provider: string, hasOctoPlugin: boolean): boolean {
    return provider === "openclaw" && !hasOctoPlugin
}
