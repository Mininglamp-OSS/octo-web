import React from "react"
import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { I18nProvider, i18n } from "@octo/base/src/i18n"
import type { ForwardSurfaceUpdate } from "@octo/base/src/features/forwarding/surfaceContract"
import { ForwardSurfaceApp, safeAvatarUrl, type ForwardSurfaceHost } from "./ForwardSurfaceApp"

function state(revision = 1): ForwardSurfaceUpdate {
  const person = { channelID: "person-a", channelType: 1, displayName: "Person A" }
  return { version: 1, id: "picker", revision, model: {
    items: [person], allItems: [person], selectedIDs: [], inputValue: "", loading: false,
    loadError: false, activeTab: "recent", locale: "zh-CN", theme: "light",
    botPreview: [{ uid: "person-a", bots: [{ uid: "bot-a", name: "Bot A" }] }],
  } }
}

function setup(getState: ForwardSurfaceHost["getState"] = async () => state()) {
  let push: (value: ForwardSurfaceUpdate) => void = () => {}
  const off = vi.fn()
  const host = {
    getState,
    onState: vi.fn((listener) => { push = listener; return off }),
    dispatch: vi.fn().mockResolvedValue(undefined),
  }
  const view = render(<I18nProvider><ForwardSurfaceApp host={host} /></I18nProvider>)
  return { ...view, host, off, push: (value: ForwardSurfaceUpdate) => act(() => push(value)) }
}

afterEach(() => {
  i18n.setLocale("zh-CN")
  document.body.removeAttribute("theme-mode")
})

describe("standalone forwarding UI", () => {
  it("keeps focus, optimistic input and expanded previews while accepting snapshots", async () => {
    const ui = setup()
    await waitFor(() => expect(ui.container.querySelector("input")).toBeTruthy())
    const input = ui.container.querySelector("input")!
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: "first" } })
    fireEvent.change(input, { target: { value: "latest" } })
    expect(input.value).toBe("latest")
    ui.push({ ...state(2), model: { ...state().model!, inputValue: "first" } })
    expect(input.value).toBe("latest")
    expect(ui.container.querySelector("input")).toBe(input)
    expect(document.activeElement).toBe(input)
    ui.push({ ...state(3), model: { ...state().model!, inputValue: "latest" } })
    fireEvent.click(ui.container.querySelector(".wk-fm-item-bot-expand")!)
    expect(ui.container.querySelector(".wk-fm-item-bots")?.textContent).toContain("Bot A")
    ui.push({ ...state(4), model: { ...state().model!, inputValue: "latest", selectedIDs: ["person-a"] } })
    expect(ui.container.querySelector(".wk-fm-item-bots")?.textContent).toContain("Bot A")
    fireEvent.change(input, { target: { value: "" } })
    expect(ui.host.dispatch).toHaveBeenCalledWith({ id: "picker", revision: 4, action: { type: "input", value: "" } })
  })

  it("forwards visibility, candidate identity, confirmation and Escape through the same port", async () => {
    const ui = setup()
    await waitFor(() => expect(ui.container.querySelector(".wk-fm-item")).toBeTruthy())
    await waitFor(() => expect(ui.host.dispatch).toHaveBeenCalledWith({
      id: "picker", revision: 1, action: { type: "visible", channelID: "person-a", channelType: 1 },
    }))
    fireEvent.click(ui.container.querySelector(".wk-fm-item")!)
    expect(ui.host.dispatch).toHaveBeenCalledWith({
      id: "picker", revision: 1, action: { type: "toggle", channelID: "person-a", channelType: 1 },
    })
    ui.push({ ...state(2), model: { ...state().model!, selectedIDs: ["person-a"] } })
    fireEvent.click(ui.container.querySelector(".wk-fm-btn--confirm")!)
    expect(ui.host.dispatch).toHaveBeenCalledWith({ id: "picker", revision: 2, action: { type: "confirm" } })
    fireEvent.keyDown(window, { key: "Escape" })
    expect(ui.host.dispatch).toHaveBeenLastCalledWith({ id: "picker", revision: 2, action: { type: "cancel" } })
    ui.unmount()
    expect(ui.off).toHaveBeenCalledOnce()
  })

  it("ignores late initial reads, stale snapshots and updates after unmount", async () => {
    let resolve!: (value: ForwardSurfaceUpdate) => void
    const ui = setup(() => new Promise(done => { resolve = done }))
    ui.push({ ...state(5), model: { ...state().model!, title: "Newest" } })
    await act(async () => resolve(state(1)))
    ui.push(state(2))
    expect(ui.container.querySelector(".wk-fm-title")?.textContent).toBe("Newest")
    ui.unmount()
    ui.push(state(6))
    expect(ui.off).toHaveBeenCalledOnce()
  })

  it("applies host theme/locale and retains selected Bot controls", async () => {
    const ui = setup()
    await waitFor(() => expect(ui.container.querySelector(".wk-fm")).toBeTruthy())
    ui.push({ ...state(2), model: {
      ...state().model!, theme: "dark", locale: "en-US", selectedIDs: ["person-a"],
      grant: { canGrant: true, enabled: true, role: "writer", bots: {
        ready: true, peopleCount: 1, botCount: 1,
        groups: [{ uid: "person-a", name: "Person A", bots: [{ uid: "bot-a", name: "Bot A", selected: true }] }],
      } },
    } })
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"))
    expect(document.body.getAttribute("theme-mode")).toBe("dark")
    expect(ui.container.querySelector(".wk-fm-selected-bots")?.textContent).toContain("Bot A")
    fireEvent.click(ui.container.querySelector(".wk-fm-selected-bot [role=checkbox]")!)
    expect(ui.host.dispatch).toHaveBeenCalledWith({ id: "picker", revision: 2, action: { type: "toggleBot", uid: "bot-a" } })
  })

  it("does not accept executable, file, credentialed or malformed avatar URLs", () => {
    for (const value of ["file:///etc/passwd", "javascript:alert(1)", "http://user:secret@example.com", "data:text/html,hello", "/local"]) {
      expect(safeAvatarUrl(value)).toBeUndefined()
    }
    expect(safeAvatarUrl("https://example.com/avatar")).toBe("https://example.com/avatar")
  })
})
