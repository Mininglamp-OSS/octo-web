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
    it("claude → 3 步 (安装 / 配置 / 启动)", () => {
        const g = getInstallGuide("claude")
        expect(g).not.toBeNull()
        expect(g!.steps).toHaveLength(3)
        expect(g!.steps[0].command).toBe("npm install -g @mininglamp-oss/cc-channel-octo")
        expect(g!.steps[2].command).toBe("cc-channel-octo")
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
        expect(text).toMatch(/^ {3}\(/m)
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
