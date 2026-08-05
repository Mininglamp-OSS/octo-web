import { describe, expect, it } from "vitest"
import { resolveApiURL } from "../apiURL"

describe("resolveApiURL", () => {
  it("uses the Vite proxy for desktop development", () => {
    expect(
      resolveApiURL({ isDesktop: true, isDev: true, rawApiURL: "https://api.example.com" }),
    ).toBe("/api/v1/")
  })

  it("uses the configured API origin for desktop production", () => {
    expect(
      resolveApiURL({
        isDesktop: true,
        isDev: false,
        rawApiURL: "https://api.example.com/legacy/path",
      }),
    ).toBe("https://api.example.com/v1/")
  })

  it("uses the relative API path for web builds", () => {
    expect(
      resolveApiURL({ isDesktop: false, isDev: false, rawApiURL: "https://api.example.com" }),
    ).toBe("/api/v1/")
  })

  it("requires an API URL for desktop production", () => {
    expect(() => resolveApiURL({ isDesktop: true, isDev: false })).toThrow(
      "VITE_API_URL is required for Tauri/Electron",
    )
  })

  it("rejects an invalid API URL for desktop production", () => {
    expect(() =>
      resolveApiURL({ isDesktop: true, isDev: false, rawApiURL: "not-a-url" }),
    ).toThrow("VITE_API_URL format is invalid")
  })
})
