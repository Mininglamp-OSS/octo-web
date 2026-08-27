// @vitest-environment jsdom
import React from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import BotManageView, { CardSettingsView, MentionFreeListView } from "../index"

const labels: any = {
  mentionFree: "Mention free", mentionFreeHint: "hint", cardSettings: "Cards",
  cardSettingsHint: "card hint", autoApprove: "Approve", autoApproveHint: "approve hint",
  profileCommands: "Commands", profileCommandsHint: "command hint", comingSoon: "Soon",
  loading: "Loading", backendComingSoon: "Backend soon", stayTuned: "Stay tuned",
  loadFailed: "Failed", reload: "Reload", searchPlaceholder: "Search",
  noSearchResult: "No result", empty: "Empty", sectionEnabled: (n: number) => `Enabled ${n}`,
  sectionOthers: "Others", rowOn: "On", rowOff: "Off", rowBlocked: "Blocked",
}

describe("BotManageView", () => {
  it("exposes menu actions and all list state placeholders", () => {
    const onMention = vi.fn(), onCards = vi.fn()
    render(<BotManageView labels={labels} onOpenMentionFree={onMention} onOpenCardSettings={onCards} />)
    fireEvent.click(screen.getByText("Mention free"))
    fireEvent.click(screen.getByText("Cards"))
    expect(onMention).toHaveBeenCalled()
    expect(onCards).toHaveBeenCalled()

    const { rerender } = render(<MentionFreeListView {...baseProps()} loading backendMissing={false} loadError={false} />)
    expect(screen.getByText("Loading")).toBeTruthy()
    rerender(<MentionFreeListView {...baseProps()} loading={false} backendMissing loadError={false} />)
    expect(screen.getByText(/Backend soon/)).toBeTruthy()
    rerender(<MentionFreeListView {...baseProps()} loading={false} backendMissing={false} loadError />)
    fireEvent.click(screen.getByText("Reload"))
  })

  it("filters, toggles rows, and loads more near the scroll boundary", () => {
    const props = baseProps()
    render(<MentionFreeListView {...props} loading={false} backendMissing={false} loadError={false}
      enabledGroups={[{ groupNo: "g1", name: "Group", noMention: false }]}
      otherGroups={[{ groupNo: "g2", name: "", noMention: true, allowNoMention: false }]} loadingMore />)
    fireEvent.change(screen.getByTestId("bot-manage-mention-search"), { target: { value: "query" } })
    expect(props.onSearchKeywordChange).toHaveBeenCalledWith("query")
    const list = screen.getByTestId("bot-manage-mention-list")
    Object.defineProperties(list, { scrollTop: { value: 100, configurable: true }, clientHeight: { value: 100, configurable: true }, scrollHeight: { value: 240, configurable: true } })
    fireEvent.scroll(list)
    expect(props.onLoadMore).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("switch", { name: /Group/ }))
    expect(props.onToggleMentionFree).toHaveBeenCalledWith("g1", true, expect.anything())
    expect(screen.getByRole("switch", { name: /g2/ })).toBeDisabled()
  })

  it("renders card-setting fallbacks, master status, row metadata, and actions", () => {
    const cardLabels: any = {
      ...labels, masterLabel: "Master", masterOn: "Enabled", masterOffValue: "Disabled",
      masterReadonly: "Readonly", masterOffNotice: "No effect", needsDisplayNotice: "Needs display",
      sourceBot: "Bot", sourceDefault: "Default", sourceEnv: "Environment", reset: "Reset",
      unsupported: "Unsupported", forbidden: "Forbidden", saveFailed: "Save failed",
      saveFailedRetryable: "Try again", rateLimited: (n?: number) => `Wait ${n || 0}`,
      rowTitle: { display: "Display", interaction: "Interaction", reasoning: "Reasoning" },
      rowDesc: { display: "Display desc", interaction: "Interaction desc", reasoning: "Reasoning desc" },
    }
    const onReload = vi.fn(), onToggle = vi.fn(), onReset = vi.fn()
    const rows: any[] = [
      { key: "display", checked: true, editable: true, overridden: true, source: "bot", disabled: false, pending: false },
      { key: "interaction", checked: false, editable: true, overridden: true, source: "default", needsDisplay: true, disabled: false, pending: false },
      { key: "reasoning", checked: false, editable: false, overridden: false, source: "env", disabled: true, pending: false },
    ]
    const { rerender } = render(<CardSettingsView labels={cardLabels} rows={[]} masterEnabled={false} loading hasData={false}
      onToggle={onToggle} onReset={onReset} onReload={onReload} />)
    expect(screen.getByText("Loading")).toBeTruthy()
    for (const kind of ["backendMissing", "unsupported", "forbidden", "other"]) {
      rerender(<CardSettingsView labels={cardLabels} rows={[]} masterEnabled={false} loading={false} hasData={false}
        loadErrorKind={kind} onToggle={onToggle} onReset={onReset} onReload={onReload} />)
      if (kind === "other") fireEvent.click(screen.getByText("Reload"))
    }
    expect(onReload).toHaveBeenCalled()
    rerender(<CardSettingsView labels={cardLabels} rows={rows} masterEnabled={false} loading={false} hasData
      writeErrorKind="rateLimited" writeErrorRetryAfterSeconds={5}
      onToggle={onToggle} onReset={onReset} onReload={onReload} />)
    expect(screen.getByTestId("bot-card-settings-master-off")).toBeTruthy()
    fireEvent.click(screen.getByTestId("bot-card-switch-display"))
    fireEvent.click(screen.getByTestId("bot-card-reset-display"))
    expect(onToggle).toHaveBeenCalledWith("display", false)
    expect(onReset).toHaveBeenCalledWith("display")
    expect(screen.getByTestId("bot-card-switch-reasoning")).toBeDisabled()
  })
})

function baseProps() {
  return {
    labels, loading: false, backendMissing: false, loadError: false, searchKeyword: "",
    enabledGroups: [], otherGroups: [], loadingMore: false,
    onSearchKeywordChange: vi.fn(), onReload: vi.fn(), onLoadMore: vi.fn(), onToggleMentionFree: vi.fn(),
  }
}
