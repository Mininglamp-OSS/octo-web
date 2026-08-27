// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import GlobalSearch from "../GlobalSearchPanel"

const source: any = {
  getSelfUid: () => "me", getSenders: () => [], getSender: (uid: string) => ({ uid, name: uid }),
}

describe("GlobalSearch panel state helpers", () => {
  it("guards and routes content hits and cloud documents", () => {
    const locate = vi.fn(), hide = vi.fn(), openDoc = vi.fn()
    const panel: any = new GlobalSearch({ dataSource: source, onLocateContentItem: locate, hideModal: hide, onOpenDoc: openDoc })
    panel.handleLocate({} as any)
    expect(locate).not.toHaveBeenCalled()
    const item: any = { channelId: "g1", channelType: 2, messageSeq: 9 }
    panel.handleLocate(item)
    expect(locate).toHaveBeenCalledWith(item)
    expect(hide).toHaveBeenCalled()
    const doc: any = { docId: "d1", title: "Doc" }
    panel.handleOpenDoc(doc)
    expect(openDoc).toHaveBeenCalledWith(doc)
  })

  it("builds channel and disabled/content tab panel trees", () => {
    const panel: any = new GlobalSearch({ dataSource: source, contentSearchEnabled: false })
    panel.vm = {
      searchInChannel: true, searchResult: { messages: [] }, keyword: "hello", loadMore: vi.fn(),
      selectedTabKey: "all", onTabClick: vi.fn(),
    }
    expect(panel.tabPanels("all")).toBeTruthy()
    panel.vm.searchInChannel = false
    panel.state.filterOpen = true
    expect(panel.tabPanels("contacts")).toBeTruthy()
    expect(panel.tabPanels("messages")).toBeTruthy()
    expect(panel.tabPanels("files")).toBeTruthy()
    expect(panel.tabPanels("docs")).toBeTruthy()
    panel.vm.onTabClick("files")
    expect(panel.vm.onTabClick).toHaveBeenCalledWith("files")
  })

  it("builds the search workspace render callback and input actions", () => {
    const panel: any = new GlobalSearch({ dataSource: source, contentSearchEnabled: false, initialState: { searchValue: "old" } })
    panel.vm = {
      searchInChannel: false, searchTitle: "", keyword: "old", searchResult: {},
      selectedTabKey: "all", tabList: [{ itemKey: "all", tab: "All" }], searchError: undefined,
      isComposing: false, handleInputChange: vi.fn(), onTabClick: vi.fn(), loadMore: vi.fn(),
    }
    const provider: any = panel.render()
    const rendered: any = provider.props.render(panel.vm)
    expect(rendered).toBeTruthy()
    expect(rendered.props.children).toBeTruthy()
    const enabled: any = new GlobalSearch({ dataSource: source, contentSearchEnabled: true })
    enabled.vm = { ...panel.vm, selectedTabKey: "messages", tabList: [{ itemKey: "messages", tab: "Messages" }] }
    expect(enabled.render().props.render(enabled.vm)).toBeTruthy()
  })

  it("handles filter and tab transitions without losing selected filters", () => {
    const panel: any = new GlobalSearch({ dataSource: source, contentSearchEnabled: true })
    const first = { ...panel.state.filters, fileExts: ["pdf"] }
    panel.vm = { selectedTabKey: "messages", onTabClick: vi.fn() }
    panel.setState = (update: any, callback?: () => void) => {
      panel.state = { ...panel.state, ...(typeof update === "function" ? update(panel.state) : update) }
      callback?.()
    }
    panel.handleApplyFilters(first, { fileTypeCategoryKeys: ["docs"] })
    expect(panel.state.filters.fileExts).toEqual(["pdf"])
    expect(panel.state.fileTypeCategoryKeys).toEqual(["docs"])
    panel.handleTabChange("contacts")
    expect(panel.vm.onTabClick).toHaveBeenCalledWith("contacts")
    panel.handleTabChange("files")
    expect(panel.state.filters.fileExts).toEqual([])
    expect(panel.state.fileTypeCategoryKeys).toEqual([])
    expect(panel.vm.onTabClick).toHaveBeenCalledWith("files")
  })

  it("covers locate fallback, document fallback, and config listener lifecycle", () => {
    const panel: any = new GlobalSearch({ dataSource: source, contentSearchEnabled: true, hideModal: vi.fn() })
    panel.vm = { selectedTabKey: "all", onTabClick: vi.fn() }
    const locateItem: any = { channelId: "g1", channelType: 2, messageSeq: 17 }
    panel.handleLocate(locateItem)
    expect(panel.props.hideModal).toHaveBeenCalled()
    panel.handleOpenDoc({ docId: "unwired" } as any)
    panel.componentDidMount()
    panel.componentWillUnmount()
    expect(panel.props.hideModal).toHaveBeenCalled()
  })

  it("exercises the rendered workspace callbacks and filter actions", () => {
    const panel: any = new GlobalSearch({
      dataSource: source,
      contentSearchEnabled: true,
      initialState: { searchValue: "seed", filters: { ...panelFilters(), senderUids: ["u1"] } },
    })
    panel.vm = {
      searchInChannel: false, searchTitle: "", keyword: "seed", searchResult: {},
      selectedTabKey: "messages", tabList: [{ itemKey: "messages", tab: "Messages" }],
      searchError: "failed", isComposing: false, handleInputChange: vi.fn(), onTabClick: vi.fn(), loadMore: vi.fn(),
    }
    panel.setState = (update: any) => {
      panel.state = { ...panel.state, ...(typeof update === "function" ? update(panel.state) : update) }
    }
    const root: any = panel.render()
    const rendered: any = root.props.render(panel.vm)
    const workspace: any = (Array.isArray(rendered.props.children) ? rendered.props.children : [rendered.props.children])
      .flatMap((child: any) => child?.props?.children ?? [])
      .find((child: any) => child?.props?.search)
    const search = workspace.props.search
    search.onCompositionStart()
    expect(panel.vm.isComposing).toBe(true)
    search.onChange("ignored")
    search.onCompositionEnd({ currentTarget: { value: "finished" } })
    expect(panel.vm.handleInputChange).toHaveBeenCalledWith("finished")
    const actions: any = workspace.props.actions
    const actionButtons: any[] = Array.isArray(actions?.props?.children) ? actions.props.children : [actions]
    actionButtons.filter(Boolean).forEach((button: any) => button.props?.onClick?.())
    expect(panel.state.filterOpen).toBe(true)
  })
})

function panelFilters() {
  return { senderUids: [], memberUids: [], channels: [], channelTypes: [], contentTypes: [], fileExts: [], sort: "time_desc" }
}
