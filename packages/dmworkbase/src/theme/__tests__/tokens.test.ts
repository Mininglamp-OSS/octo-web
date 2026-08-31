import { describe, expect, it } from "vitest"
import { animation, colors, cssVarNames, layout, radius, spacing, typography } from "../tokens"

describe("design token exports", () => {
  it("exposes the semantic token groups used by runtime styles", () => {
    expect(colors.brand.primary).toBeTruthy()
    expect(colors.dark.textPrimary).toBeTruthy()
    expect(colors.light.bgSurface).toBe("#FFFFFF")
    expect(spacing[4]).toBe(16)
    expect(radius.full).toBe(9999)
    expect(typography.sizes.body).toBe(14)
    expect(typography.weights.semibold).toBe(600)
    expect(animation.durSlow).toBe(350)
    expect(layout.sidebarWidth).toBe(240)
    expect(cssVarNames.aiBorder).toBe("--wk-ai-border")
  })
})
