// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
const state: any = { loading: false, error: undefined, queryStarted: false, response: { items: [], hasMore: false }, loadingMore: false, paginationError: undefined, autoPaginationPaused: false, loadNextPage: vi.fn(), handleScroll: vi.fn(), contentRef: { current: null } }
vi.mock("../../../bridge/search/useSearchPagination", () => ({ default: () => state, useSearchPagination: () => state }))
vi.mock("../../../ui/SearchWorkspace", () => ({ default: (p: any) => <div data-testid="workspace"><input aria-label="search" value={p.search.value} onChange={(e) => p.search.onChange(e.target.value)} /><button onClick={() => p.onTabChange?.("media")}>media</button><button onClick={() => p.onTabChange?.("file")}>file</button>{p.actions}{p.children}</div> }))
vi.mock("../../../Components/ChannelSearch/ChannelSearchFilters", () => ({ ChannelSearchFilterPopover: () => null }))
vi.mock("../ChannelSearchFilters", () => ({ ChannelSearchFilterPopover: () => null }))
vi.mock("../../../Components/IconClick", () => ({ default: (p: any) => <button onClick={p.onClick}>{p.title}</button> }))
vi.mock("../ChannelSearchResults", () => ({
  ChannelSearchEmpty: (p: any) => <div data-testid="empty">{String(p.queryStarted)}</div>,
  FileResultItem: (p: any) => <button onClick={() => p.onLocate(p.item)}>{p.item.id}</button>,
  MediaResultGrid: (p: any) => <button onClick={() => p.onPreviewMedia?.(p.items[0])}>media result</button>,
  MixedResultItem: (p: any) => <button onClick={() => p.onLocate(p.item)}>mixed result</button>,
}))
vi.mock("../../../i18n", () => ({ useI18n: () => ({ t: (key: string) => key }), I18nContext: React.createContext({ t: (key: string) => key }) }))

import ChannelSearchPanel from "../ChannelSearchPanel"

const channel: any = { channelID: "g1", channelType: 2 }
const dataSource: any = { getSender: vi.fn(), searchMessages: vi.fn(async () => ({ items: [], hasMore: false })) }

describe("ChannelSearchPanel render states", () => {
  it("handles input, composition, tabs, close, filter, and loading/error states", () => {
    const close = vi.fn()
    const { rerender } = render(<ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={close} />)
    fireEvent.change(screen.getByLabelText("search"), { target: { value: "hello" } })
    fireEvent.click(screen.getByText("media"))
    fireEvent.click(screen.getByText("file"))
    fireEvent.click(screen.getByText("base.channelSearch.filter.title"))
    state.loading = true
    rerender(<ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={close} />)
    expect(screen.getByText("base.channelSearch.loading")).toBeInTheDocument()
    state.loading = false; state.error = "failed"; state.queryStarted = true
    rerender(<ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={close} />)
    expect(screen.getByText("failed")).toBeInTheDocument()
    state.error = undefined; state.queryStarted = false
  })

  it("renders mixed, media, and file results plus pagination retry", () => {
    const locate = vi.fn(), preview = vi.fn()
    state.queryStarted = true; state.response = { items: [{ id: "r1", kind: "image" }], hasMore: true }
    state.autoPaginationPaused = true; state.paginationError = "retry"; state.loadingMore = false
    const { rerender } = render(<ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={vi.fn()} onLocateMessage={locate} onPreviewMedia={preview} />)
    expect(screen.getByText("mixed result")).toBeInTheDocument()
    fireEvent.click(screen.getByText("base.channelSearch.loadMore"))
    expect(state.loadNextPage).toHaveBeenCalled()
    state.paginationError = undefined
    fireEvent.click(screen.getByText("media"))
    rerender(<ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={vi.fn()} onLocateMessage={locate} onPreviewMedia={preview} initialState={{ activeTab: "media" }} />)
    fireEvent.click(screen.getByText("media result"))
    expect(preview).toHaveBeenCalled()
    fireEvent.click(screen.getByText("file"))
    expect(screen.getByText("r1")).toBeInTheDocument()
  })
})

describe("ChannelSearchPanel filter trigger a11y and count", () => {
  const getTrigger = (container: HTMLElement): HTMLElement => {
    const el = container.querySelector(".wk-channel-search-filter-trigger");
    if (!(el instanceof HTMLElement)) throw new Error("filter trigger not found");
    return el;
  };

  it("wraps title and exposes accessible name without aria-label", () => {
    const { container } = render(
      <ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={vi.fn()} />
    );
    const trigger = getTrigger(container);
    const label = trigger.querySelector(".wk-channel-search-filter-label");
    expect(label).toBeTruthy();
    expect(label?.textContent).toBe("base.channelSearch.filter.title");
    expect(trigger.getAttribute("aria-label")).toBeNull();
    expect(trigger.getAttribute("title")).toBe("base.channelSearch.filter.title");
    // Default filters: no active count, so accessible name is the title text.
    const named = screen.getByRole("button", { name: "base.channelSearch.filter.title" });
    expect(named).toBe(trigger);
  });

  it("toggles aria-expanded when the trigger is clicked", () => {
    const { container } = render(
      <ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={vi.fn()} />
    );
    const trigger = getTrigger(container);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders count in wk-channel-search-filter-count with initial filters", () => {
    const initialState: any = {
      filters: { senderUids: ["u1"], sort: "time_asc", datePreset: "today" },
    };
    const { container } = render(
      <ChannelSearchPanel channel={channel} dataSource={dataSource} onClose={vi.fn()} initialState={initialState} />
    );
    const trigger = getTrigger(container);
    const count = trigger.querySelector(".wk-channel-search-filter-count");
    expect(count).toBeTruthy();
    expect(count?.textContent).toBe("3");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
