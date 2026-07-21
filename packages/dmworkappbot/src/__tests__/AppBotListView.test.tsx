// @vitest-environment jsdom
import React from "react"
import ReactDOM from "react-dom"
import { act } from "react-dom/test-utils"
import { fireEvent, screen } from "@testing-library/dom"
import "@testing-library/jest-dom/vitest"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AppBotListView, { AppBotListViewProps } from "../ui/AppBotListView"

let container: HTMLDivElement

const baseProps = (overrides: Partial<AppBotListViewProps> = {}): AppBotListViewProps => ({
  title: "Apps",
  searchPlaceholder: "Search",
  keyword: "",
  state: "ready",
  sections: [{
    key: "platform",
    title: "Platform apps",
    bots: [{
      id: "bot-1",
      uid: "robot_1",
      displayName: "Docs Bot",
      description: "Search docs",
      scope: "platform",
    }],
  }],
  selectedUid: null,
  loadingText: "Loading",
  loadFailedText: "Failed",
  retryLabel: "Retry",
  emptyText: "Empty",
  noMatchesText: "No matches",
  defaultDescription: "App Bot",
  onKeywordChange: vi.fn(),
  onRetry: vi.fn(),
  onSelect: vi.fn(),
  renderAvatar: () => React.createElement("span", null, "D"),
  ...overrides,
})

const renderView = (props: AppBotListViewProps) => {
  act(() => {
    ReactDOM.render(React.createElement(AppBotListView, props), container)
  })
}

describe("AppBotListView", () => {
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

  it("emits search and select interactions through props", () => {
    const onKeywordChange = vi.fn()
    const onSelect = vi.fn()
    renderView(baseProps({ onKeywordChange, onSelect }))

    act(() => {
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "docs" } })
    })
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Docs Bot/ }))
    })

    expect(onKeywordChange).toHaveBeenCalledWith("docs")
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ uid: "robot_1" }))
  })

  it("shows the retry action in error state", () => {
    const onRetry = vi.fn()
    renderView(baseProps({ state: "error", onRetry }))

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    })

    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
