// provider → Octo 插件安装指导. 说明文字走 i18n key (调用方注入 t),
// 命令是常量不翻译. buildInstallCopyText 把"说明 + 编号命令"拼成一整段,
// 供用户复制后粘贴给 runtime agent 自动安装.
import type { RuntimeKind } from "./botsApi"

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

// cc-channel-octo 全局配置: 只需 apiUrl(daemon 不写全局, 用户配一次).
// 用真实可执行 shell 命令(mkdir + heredoc 写文件), 复制到终端可直接跑;
// 每个 bot 的 token/model 由 daemon 在 web 添加 bot 时自动下发, 用户无需手配.
// <OCTO_API_URL> 是占位符: 调用方可传入真实 server_url 自动替换(见 getInstallGuide
// 的 apiUrl 参数), 拿不到时保留占位让用户手填.
const OCTO_API_URL_PLACEHOLDER = "<OCTO_API_URL>"
const CLAUDE_CONFIG_TEMPLATE = `mkdir -p ~/.cc-channel-octo && cat > ~/.cc-channel-octo/config.json <<'EOF'
{ "apiUrl": "${OCTO_API_URL_PLACEHOLDER}" }
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
                // Manual step, no command: model creds are the user's own secret,
                // and a second `cat > config.json` would overwrite step2's good
                // config with placeholders on copy-all. The note lists the sdk
                // fields to add. (Jerry-Xin/lml2468 #414)
                titleKey: "base.runtimes.install.claude.step3.title",
                noteKey: "base.runtimes.install.claude.step3.note",
            },
            {
                titleKey: "base.runtimes.install.claude.step4.title",
                command: "cc-channel-octo",
            },
        ],
    },
}

export function getInstallGuide(provider: string, apiUrl?: string): InstallGuide | null {
    // hasOwnProperty 守卫: 防 'constructor'/'toString' 等原型链键绕过白名单
    // 返回继承自 Object.prototype 的函数(真值).
    if (!Object.prototype.hasOwnProperty.call(INSTALL_GUIDES, provider)) return null
    const guide = (INSTALL_GUIDES as Record<string, InstallGuide>)[provider]
    return applyApiUrl(guide, apiUrl)
}

// 把命令里的 <OCTO_API_URL> 占位替换成真实 server_url(来自 daemon onboarding,
// 与 daemon 的 OCTO_SERVER_URL 同源)。apiUrl 为空时原样返回(保留占位让用户手填)。
// 注意 server_url 是基址(不含 /v1)—— cc-channel-octo 自己拼 /v1/bot/...。
function applyApiUrl(guide: InstallGuide, apiUrl?: string): InstallGuide {
    const url = apiUrl?.trim()
    if (!url) return guide
    return {
        ...guide,
        steps: guide.steps.map((step) =>
            step.command?.includes(OCTO_API_URL_PLACEHOLDER)
                ? { ...step, command: step.command.split(OCTO_API_URL_PLACEHOLDER).join(url) }
                : step,
        ),
    }
}

// buildInstallCopyText 的 t 只用无插值的 key, 故签名收窄到 (key) => string;
// 真实 t (key, options?: TranslateOptions) => string 可安全赋值给它,
// 避免 TranslateOptions.values 在 strictFunctionTypes 下逆变不兼容.
type TFn = (key: string) => string

export function buildInstallCopyText(provider: string, t: TFn, apiUrl?: string): string {
    const guide = getInstallGuide(provider, apiUrl)
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
