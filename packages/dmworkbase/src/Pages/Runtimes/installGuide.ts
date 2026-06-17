// provider → Octo 插件安装指导. 说明文字走 i18n key (调用方注入 t),
// 命令是常量不翻译. buildInstallCopyText 把"说明 + 编号命令"拼成一整段,
// 供用户复制后粘贴给 runtime agent 自动安装.
import type { RuntimeKind } from "./botsApi"

export interface InstallStep {
    titleKey: string
    command: string
    noteKey?: string
}

export interface InstallGuide {
    introKey: string
    steps: InstallStep[]
}

// cc-channel-octo 全局配置: 只需 apiUrl(daemon 不写全局, 用户配一次).
// 用真实可执行 shell 命令(mkdir + heredoc 写文件), 复制到终端可直接跑;
// 每个 bot 的 token/model 由 daemon 在 web 添加 bot 时自动下发, 用户无需手配.
const CLAUDE_CONFIG_TEMPLATE = `mkdir -p ~/.cc-channel-octo && cat > ~/.cc-channel-octo/config.json <<'EOF'
{ "apiUrl": "<OCTO_API_URL>" }
EOF`

const INSTALL_GUIDES: Record<RuntimeKind, InstallGuide> = {
    openclaw: {
        introKey: "base.runtimes.install.openclaw.intro",
        steps: [
            {
                titleKey: "base.runtimes.install.openclaw.step1.title",
                command: "npx -y create-openclaw-octo install",
            },
        ],
    },
    claude: {
        introKey: "base.runtimes.install.claude.intro",
        steps: [
            {
                titleKey: "base.runtimes.install.claude.step1.title",
                command: "npm install -g @mininglamp-oss/cc-channel-octo",
            },
            {
                titleKey: "base.runtimes.install.claude.step2.title",
                command: CLAUDE_CONFIG_TEMPLATE,
                noteKey: "base.runtimes.install.claude.step2.note",
            },
            {
                titleKey: "base.runtimes.install.claude.step3.title",
                command: "cc-channel-octo",
            },
        ],
    },
}

export function getInstallGuide(provider: string): InstallGuide | null {
    // hasOwnProperty 守卫: 防 'constructor'/'toString' 等原型链键绕过白名单
    // 返回继承自 Object.prototype 的函数(真值).
    if (!Object.prototype.hasOwnProperty.call(INSTALL_GUIDES, provider)) return null
    return (INSTALL_GUIDES as Record<string, InstallGuide>)[provider]
}

// buildInstallCopyText 的 t 只用无插值的 key, 故签名收窄到 (key) => string;
// 真实 t (key, options?: TranslateOptions) => string 可安全赋值给它,
// 避免 TranslateOptions.values 在 strictFunctionTypes 下逆变不兼容.
type TFn = (key: string) => string

export function buildInstallCopyText(provider: string, t: TFn): string {
    const guide = getInstallGuide(provider)
    if (!guide) return ""
    const lines: string[] = [t(guide.introKey)]
    guide.steps.forEach((step, i) => {
        lines.push(`${i + 1}. ${t(step.titleKey)}: ${step.command}`)
        if (step.noteKey) lines.push(`   (${t(step.noteKey)})`)
    })
    return lines.join("\n")
}
