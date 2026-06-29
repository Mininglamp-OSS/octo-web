import { describe, it, expect } from "vitest"
import { getInstallGuide, buildInstallCopyText } from "./installGuide"
import { t } from "../../i18n/instance"

describe("getInstallGuide — provider 安装步骤", () => {
    it("octo_daemon → 3 步 (安装 / 配置 / 启动)", () => {
        const g = getInstallGuide("octo_daemon")
        expect(g).not.toBeNull()
        expect(g!.steps).toHaveLength(3)
        expect(g!.steps[0].command).toBe("npm install -g @mininglamp-oss/octo-daemon")
        expect(g!.steps[2].command).toBe("octo-daemon start")
        // step3 = 启动: 带重启提示 note
        expect(g!.steps[2].noteKey).toBeTruthy()
    })
    it("claude / openclaw → null (插件安装改走 runtime 页一键按钮, 不再有手动命令指引)", () => {
        expect(getInstallGuide("claude")).toBeNull()
        expect(getInstallGuide("openclaw")).toBeNull()
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
    it("octo_daemon: 含安装/配置/启动命令 + 全编号 + note + i18n 解析", () => {
        const text = buildInstallCopyText("octo_daemon", t)
        expect(text).toContain("npm install -g @mininglamp-oss/octo-daemon")
        expect(text).toContain("octo-daemon config")
        expect(text).toContain("octo-daemon start")
        expect(text).toMatch(/^1\. /m)
        expect(text).toMatch(/^3\. /m)
        expect(text).toMatch(/^ {3}\(/m) // step3 note 缩进
        // 所有 i18n key 都解析了 (t 缺 key 时回退为 key 本身, 拼错会留下前缀)
        expect(text).not.toContain("base.runtimes.install")
    })
    it("claude / openclaw / 未知 provider → 空串", () => {
        expect(buildInstallCopyText("claude", t)).toBe("")
        expect(buildInstallCopyText("openclaw", t)).toBe("")
        expect(buildInstallCopyText("unknown", t)).toBe("")
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
    it("空/空白 url: 保留占位让用户手填", () => {
        expect(getInstallGuide("octo_daemon", { apiUrl: "" })!.steps[1].command).toContain("<OCTO_SERVER_URL>")
        expect(getInstallGuide("octo_daemon", { apiUrl: "   " })!.steps[1].command).toContain("<OCTO_SERVER_URL>")
    })
})
