// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { fireEvent, getAllByRole, getByRole } from "@testing-library/dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../../i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

import { TabsBar } from "../TabsBar"
import type { ChatSelectorTab } from "../../../ChatSelector/tabFilter"

describe("ForwardModal TabsBar", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => ReactDOM.unmountComponentAtNode(container))
    container.remove()
    vi.restoreAllMocks()
  })

  const render = (activeTab: ChatSelectorTab, onTabChange = vi.fn()) => {
    act(() => {
      ReactDOM.render(
        <TabsBar activeTab={activeTab} onTabChange={onTabChange} />,
        container,
      )
    })
    return onTabChange
  }

  it("renders the four controlled forward filters with the md line variant", () => {
    render("recent")

    const tablist = getByRole(container, "tablist", {
      name: "base.forwardModal.title",
    })
    const tabs = getAllByRole(tablist, "tab")

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "base.forwardModal.tabFollowed",
      "base.forwardModal.tabRecent",
      "base.forwardModal.tabAllGroups",
      "base.forwardModal.tabAllDirects",
    ])
    expect(tabs[1].getAttribute("aria-selected")).toBe("true")
    expect(tablist.parentElement?.className).toContain("wk-fm-tabs")
    expect(tablist.parentElement?.className).toContain("octo-ui-tabs--line")
    expect(tablist.parentElement?.className).toContain("octo-ui-tabs--md")
  })

  it("maps tab clicks back to the existing ChatSelectorTab keys", () => {
    const onTabChange = render("recent")
    const tablist = getByRole(container, "tablist")
    const tabs = getAllByRole(tablist, "tab")

    act(() => fireEvent.click(tabs[0]))
    act(() => fireEvent.click(tabs[2]))
    act(() => fireEvent.click(tabs[3]))

    expect(onTabChange.mock.calls.map(([key]) => key)).toEqual([
      "followed",
      "group",
      "direct",
    ])
  })
})
