// provider → 安装指导. 说明文字走 i18n key (调用方注入 t), 命令是常量不翻译.
// buildInstallCopyText 把"说明 + 编号命令"拼成一整段, 供用户复制后粘贴执行.
//
// 目前只剩 octo_daemon 一条 (CreateRuntimeModal 用): runtime 适配插件
// (claude→cc-octo / openclaw→octo) 的安装/升级改由 runtime 页的一键
// 「安装」/「升级」按钮处理, 不再提供手动命令指引气泡.

export interface InstallStep {
    titleKey: string
    /** Shell command. Omitted for manual/instruction-only steps (no copy button). */
    command?: string
    noteKey?: string
}

export interface InstallGuide {
    introKey: string
    steps: InstallStep[]
}

// octo_daemon 安装命令里的占位符: 调用方传入真实值时自动替换 (见 getInstallGuide
// 的 apiUrl/apiKey 参数), 拿不到时保留占位让用户手填. apiUrl → <OCTO_SERVER_URL>
// (基址不含 /v1, 由 daemon 自己拼 /v1、/fleet/api); apiKey → <OCTO_API_KEY>.
const OCTO_SERVER_URL_PLACEHOLDER = "<OCTO_SERVER_URL>"
const OCTO_API_KEY_PLACEHOLDER = "<OCTO_API_KEY>"

// CreateRuntime 弹框用: 安装/配置/启动 octo-daemon, 命令为常量。
// 不走 onboarding, server-url/api-key 用占位符让用户手填。
const INSTALL_GUIDES: Record<"octo_daemon", InstallGuide> = {
    octo_daemon: {
        introKey: "base.runtimes.install.octo_daemon.intro",
        steps: [
            {
                titleKey: "base.runtimes.install.octo_daemon.step1.title",
                command: "npm install -g @mininglamp-oss/octo-daemon",
            },
            {
                titleKey: "base.runtimes.install.octo_daemon.step2.title",
                command: 'octo-daemon config --server-url "<OCTO_SERVER_URL>" --api-key "<OCTO_API_KEY>"',
            },
            {
                titleKey: "base.runtimes.install.octo_daemon.step3.title",
                command: "octo-daemon start",
                noteKey: "base.runtimes.install.octo_daemon.step3.note",
            },
        ],
    },
}

export interface InstallGuideVars {
    /** 真实 server_url 基址(不含 /v1): 替换 <OCTO_SERVER_URL>. */
    apiUrl?: string
    /** 真实 api_key(来自 runtime onboarding): 替换 <OCTO_API_KEY>. */
    apiKey?: string
}

export function getInstallGuide(provider: string, vars?: InstallGuideVars): InstallGuide | null {
    // hasOwnProperty 守卫: 防 'constructor'/'toString' 等原型链键绕过白名单
    // 返回继承自 Object.prototype 的函数(真值).
    if (!Object.prototype.hasOwnProperty.call(INSTALL_GUIDES, provider)) return null
    const guide = (INSTALL_GUIDES as Record<string, InstallGuide>)[provider]
    return applyPlaceholders(guide, vars)
}

// 把命令里的占位替换成真实值: apiUrl → <OCTO_SERVER_URL>(基址不含 /v1, 由
// daemon 自己拼 /v1/...); apiKey → <OCTO_API_KEY>. 某个值为空时保留对应占位让用户手填.
function applyPlaceholders(guide: InstallGuide, vars?: InstallGuideVars): InstallGuide {
    const subs: [string, string][] = []
    const url = vars?.apiUrl?.trim()
    if (url) subs.push([OCTO_SERVER_URL_PLACEHOLDER, url])
    const key = vars?.apiKey?.trim()
    if (key) subs.push([OCTO_API_KEY_PLACEHOLDER, key])
    if (subs.length === 0) return guide
    return {
        ...guide,
        steps: guide.steps.map((step) => {
            if (!step.command) return step
            let command = step.command
            for (const [placeholder, value] of subs) command = command.split(placeholder).join(value)
            return { ...step, command }
        }),
    }
}

// buildInstallCopyText 的 t 只用无插值的 key, 故签名收窄到 (key) => string;
// 真实 t (key, options?: TranslateOptions) => string 可安全赋值给它,
// 避免 TranslateOptions.values 在 strictFunctionTypes 下逆变不兼容.
type TFn = (key: string) => string

export function buildInstallCopyText(provider: string, t: TFn, vars?: InstallGuideVars): string {
    const guide = getInstallGuide(provider, vars)
    if (!guide) return ""
    const lines: string[] = [t(guide.introKey)]
    guide.steps.forEach((step, i) => {
        // Manual steps (no command) render as a numbered instruction; steps with
        // a command append it after the title.
        lines.push(step.command ? `${i + 1}. ${t(step.titleKey)}: ${step.command}` : `${i + 1}. ${t(step.titleKey)}`)
        if (step.noteKey) lines.push(`   (${t(step.noteKey)})`)
    })
    return lines.join("\n")
}
