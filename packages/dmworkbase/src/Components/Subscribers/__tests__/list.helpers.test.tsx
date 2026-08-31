// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import { SubscriberList } from "../list"
import { Channel } from "wukongimjssdk"

describe("SubscriberList selection helpers", () => {
  it("covers selection, display names, online tips, and prefetch guards", () => {
    const onSelect = vi.fn()
    const list: any = new SubscriberList({ channel: new Channel("g", 2), canSelect: true, onSelect, singleSelect: false, disableSelectList: ["disabled"] })
    list.context = { t: (key: string) => key }
    list.setState = (update: any) => {
      const next = typeof update === "function" ? update(list.state, list.props) : update
      if (next) list.state = { ...list.state, ...next }
    }
    const a: any = { uid: "u1", name: "Alice", remark: "Remark", role: 1 }
    const b: any = { uid: "u2", name: "Bob", role: 2 }
    expect(list.isDisableItem("disabled")).toBe(true)
    expect(list.isDisableItem("u1")).toBe(false)
    expect(list.getShowName(a)).toBe("Remark")
    expect(list.getRoleName(a)).toBeTruthy()
    list.checkItem(a)
    list.checkItem(b)
    expect(list.isCheckItem(a)).toBe(true)
    list.checkItem(a)
    expect(onSelect).toHaveBeenCalled()
    list.prefetchSubscribersChannelInfo([a, a, b])
    const vm: any = { search: vi.fn(), loadMoreSubscribersIfNeed: vi.fn(), removeSubscriber: vi.fn() }
    list.onSearch("abc", vm)
    list.handleScroll({ target: { scrollTop: 1000, clientHeight: 500, scrollHeight: 1200 } } as any, vm)
    list.onItemClick(a)
    list.componentDidMount()
    list.componentWillUnmount()
    expect(list.needShowOnlineStatus("missing")).toBe(false)
  })
})
