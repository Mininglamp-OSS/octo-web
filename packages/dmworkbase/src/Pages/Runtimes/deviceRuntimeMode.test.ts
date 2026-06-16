import { describe, it, expect } from "vitest"
import { deviceRuntimeMode } from "./deviceRuntimeMode"

// 构造最小入参 —— deviceRuntimeMode 只读 group.runtimes[].runtime_mode。
function group(modes: Array<string | null | undefined>): { runtimes: Array<{ runtime_mode?: string | null }> } {
    return { runtimes: modes.map((m) => ({ runtime_mode: m })) }
}

describe("deviceRuntimeMode — device 级 runtime_mode 去重", () => {
    it("0 个 runtime → 未知", () => {
        expect(deviceRuntimeMode(group([]))).toBe("未知")
    })

    it("全空字符串 runtime_mode(去重后无有效值)→ 未知", () => {
        expect(deviceRuntimeMode(group(["", ""]))).toBe("未知")
    })

    it("1 个 runtime → 返回该值", () => {
        expect(deviceRuntimeMode(group(["local"]))).toBe("local")
    })

    it("多个 runtime 同一 mode(去重后 1 个)→ 返回该值", () => {
        expect(deviceRuntimeMode(group(["local", "local", "local"]))).toBe("local")
    })

    it("多个 runtime 不同 mode(去重后 >1)→ 混合", () => {
        expect(deviceRuntimeMode(group(["local", "remote"]))).toBe("混合")
    })

    it("混入空值后仍有 1 个有效唯一值 → 返回该有效值(空值不算独立 mode)", () => {
        expect(deviceRuntimeMode(group(["local", "", "local"]))).toBe("local")
    })

    it("多有效值 + 空值混合(去重后 >1)→ 混合", () => {
        expect(deviceRuntimeMode(group(["local", "", "remote"]))).toBe("混合")
    })

    it("null runtime_mode 视为无效值 → 未知", () => {
        expect(deviceRuntimeMode(group([null]))).toBe("未知")
    })

    it("undefined runtime_mode 视为无效值 → 未知", () => {
        expect(deviceRuntimeMode(group([undefined]))).toBe("未知")
    })

    it("有效值混入 null / undefined → 返回该有效值", () => {
        expect(deviceRuntimeMode(group(["local", null, undefined]))).toBe("local")
    })
})
