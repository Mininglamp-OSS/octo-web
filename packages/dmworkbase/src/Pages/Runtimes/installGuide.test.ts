import { describe, it, expect } from "vitest"
import { getInstallGuide, buildInstallCopyText } from "./installGuide"
import { t } from "../../i18n/instance"

describe("getInstallGuide — provider 安装步骤", () => {
    it("openclaw → 1 步, 命令为 create-openclaw-octo install", () => {
        const g = getInstallGuide("openclaw")
        expect(g).not.toBeNull()
        expect(g!.steps).toHaveLength(1)
        expect(g!.steps[0].command).toBe("npx -y create-openclaw-octo install")
    })
    it("claude → 4 步 (安装 / 配置 / 模型认证 / 启动)", () => {
        const g = getInstallGuide("claude")
        expect(g).not.toBeNull()
        expect(g!.steps).toHaveLength(4)
        expect(g!.steps[0].command).toBe("npm install -g @mininglamp-oss/cc-channel-octo")
        // step3 = 模型认证: 手动步骤, 无 command(不能用可执行 heredoc 覆盖 step2 的好配置),
        // 模型字段在 note 里说明
        expect(g!.steps[2].command).toBeUndefined()
        expect(g!.steps[2].noteKey).toBeTruthy()
        expect(g!.steps[3].command).toBe("cc-channel-octo")
    })
    it("未知 provider → null", () => {
        expect(getInstallGuide("unknown")).toBeNull()
    })
    it("原型链键 (constructor/toString/hasOwnProperty) → null, 不绕过白名单", () => {
        expect(getInstallGuide("constructor")).toBeNull()
        expect(getInstallGuide("toString")).toBeNull()
        expect(getInstallGuide("hasOwnProperty")).toBeNull()
    })
})

describe("buildInstallCopyText — 整段复制文本", () => {
    it("claude: 含安装/配置/启动命令 + 可执行配置 + 全编号 + note + i18n 解析", () => {
        const text = buildInstallCopyText("claude", t)
        expect(text).toContain("npm install -g @mininglamp-oss/cc-channel-octo")
        expect(text).toContain("mkdir -p ~/.cc-channel-octo")
        expect(text).toContain("~/.cc-channel-octo/config.json")
        expect(text).toContain("<OCTO_API_URL>")
        expect(text).toMatch(/^1\. /m)
        expect(text).toMatch(/^2\. /m)
        expect(text).toMatch(/^3\. /m)
        expect(text).toMatch(/^4\. /m)
        expect(text).toMatch(/^ {3}\(/m)
        // 模型认证步骤的占位(用户自填)在整段里
        expect(text).toContain("anthropicBaseUrl")
        expect(text).toContain("ANTHROPIC_AUTH_TOKEN")
        // 所有 i18n key 都解析了 (t 缺 key 时回退为 key 本身, 拼错会留下前缀)
        expect(text).not.toContain("base.runtimes.install")
    })
    it("openclaw: 含 create-openclaw-octo 命令", () => {
        const text = buildInstallCopyText("openclaw", t)
        expect(text).toContain("npx -y create-openclaw-octo install")
    })
    it("未知 provider → 空串", () => {
        expect(buildInstallCopyText("unknown", t)).toBe("")
    })
})

describe("apiUrl 自动填充", () => {
    it("getInstallGuide(claude, {apiUrl}): 占位被替换成真实 server_url(不带 /v1)", () => {
        const g = getInstallGuide("claude", { apiUrl: "http://localhost:8090" })
        const step2 = g!.steps[1].command
        expect(step2).toContain(`"apiUrl": "http://localhost:8090"`)
        expect(step2).not.toContain("<OCTO_API_URL>")
    })
    it("getInstallGuide(claude) 不传 url: 保留占位让用户手填", () => {
        const g = getInstallGuide("claude")
        expect(g!.steps[1].command).toContain("<OCTO_API_URL>")
    })
    it("空/空白 url: 保留占位", () => {
        expect(getInstallGuide("claude", { apiUrl: "" })!.steps[1].command).toContain("<OCTO_API_URL>")
        expect(getInstallGuide("claude", { apiUrl: "   " })!.steps[1].command).toContain("<OCTO_API_URL>")
    })
    it("buildInstallCopyText 带 url: 整段含真实地址、无占位", () => {
        const text = buildInstallCopyText("claude", t, { apiUrl: "http://localhost:8090" })
        expect(text).toContain(`"apiUrl": "http://localhost:8090"`)
        expect(text).not.toContain("<OCTO_API_URL>")
    })
})

describe("octo_daemon: apiUrl + apiKey 占位替换", () => {
    it("同时填充 <OCTO_SERVER_URL> 和 <OCTO_API_KEY>", () => {
        const g = getInstallGuide("octo_daemon", { apiUrl: "https://octo.example.com", apiKey: "ak_123" })
        const cfg = g!.steps[1].command!
        expect(cfg).toContain('--server-url "https://octo.example.com"')
        expect(cfg).toContain('--api-key "ak_123"')
        expect(cfg).not.toContain("<OCTO_SERVER_URL>")
        expect(cfg).not.toContain("<OCTO_API_KEY>")
    })
    it("只传 apiUrl: server 填真值, api-key 保留占位", () => {
        const g = getInstallGuide("octo_daemon", { apiUrl: "https://octo.example.com" })
        const cfg = g!.steps[1].command!
        expect(cfg).toContain('--server-url "https://octo.example.com"')
        expect(cfg).toContain("<OCTO_API_KEY>")
    })
})

