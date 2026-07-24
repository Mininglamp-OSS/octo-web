// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"

import {
  useForwardGrant,
  type UseForwardGrantOptions,
  type UseForwardGrantResult,
} from "../useForwardGrant"

function Probe({
  options,
  onValue,
}: {
  options?: UseForwardGrantOptions
  onValue: (value: UseForwardGrantResult) => void
}) {
  const value = useForwardGrant(options)
  onValue(value)
  return null
}

describe("useForwardGrant", () => {
  let container: HTMLDivElement
  let latest: UseForwardGrantResult

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container)
    })
    container.remove()
  })

  function render(options?: UseForwardGrantOptions) {
    act(() => {
      ReactDOM.render(
        <Probe options={options} onValue={(v) => (latest = v)} />,
        container,
      )
    })
  }

  it("defaults switch OFF and role to defaultRole", () => {
    render({ canGrant: true })
    expect(latest.grantEnabled).toBe(false)
    expect(latest.grantRole).toBe("reader")
  })

  it("uses caller-provided defaultRole when specified", () => {
    render({ canGrant: true, defaultRole: "writer" })
    expect(latest.grantRole).toBe("writer")
  })

  it("resets role to defaultRole whenever the switch is turned back on (AC-4 / AC-15)", () => {
    render({ canGrant: true, defaultRole: "reader" })

    act(() => latest.setGrantEnabled(true))
    act(() => latest.setGrantRole("writer"))
    expect(latest.grantRole).toBe("writer")

    act(() => latest.setGrantEnabled(false))
    // 关掉后再打开：必须复位为 defaultRole，不得记忆上次更高级别。
    act(() => latest.setGrantEnabled(true))
    expect(latest.grantRole).toBe("reader")
  })

  it("readConfirmPayload returns undefined when options are absent (hook inactive)", () => {
    render(undefined)
    // 未激活即使强开也不产生 payload。
    act(() => latest.setGrantEnabled(true))
    expect(latest.readConfirmPayload()).toBeUndefined()
  })

  it("readConfirmPayload returns undefined when active but switch is OFF", () => {
    render({ canGrant: true })
    expect(latest.grantEnabled).toBe(false)
    expect(latest.readConfirmPayload()).toBeUndefined()
  })

  it("readConfirmPayload returns { role } when active AND enabled", () => {
    render({ canGrant: true, defaultRole: "reader" })
    act(() => latest.setGrantEnabled(true))
    act(() => latest.setGrantRole("writer"))
    expect(latest.readConfirmPayload()).toEqual({ role: "writer" })
  })

  it("readConfirmPayload keeps a stable identity across renders (safe for stable confirm)", () => {
    render({ canGrant: true })
    const first = latest.readConfirmPayload
    act(() => latest.setGrantEnabled(true))
    const second = latest.readConfirmPayload
    expect(second).toBe(first)
  })
})
