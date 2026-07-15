import { describe, it, expect } from "vitest"
import {
  filterChatSelectorItems,
  type ChatSelectorAccessors,
  type ChatSelectorTab,
  type ChatKind,
} from "../tabFilter"

// 极简测试 item：id / name / kind / parentId，复合 key = ${kindCode}::${id}。
interface TestItem {
  id: string
  name: string
  kind: ChatKind
  parentId?: string
}

const KIND_CODE: Record<ChatKind, number> = { direct: 1, group: 2, thread: 5 }

const acc: ChatSelectorAccessors<TestItem> = {
  getId: (i) => i.id,
  getName: (i) => i.name,
  getKind: (i) => i.kind,
  getParentId: (i) => i.parentId,
  getKey: (i) => `${KIND_CODE[i.kind]}::${i.id}`,
  getGroupKeyFromId: (parentId) => `${KIND_CODE.group}::${parentId}`,
}

function key(kind: ChatKind, id: string) {
  return `${KIND_CODE[kind]}::${id}`
}

// 树序：父群 → 子区（紧跟）→ 下一父群 → 私聊
const ITEMS: TestItem[] = [
  { id: "g1", name: "Engineering", kind: "group" },
  { id: "t1", name: "Daily Standup", kind: "thread", parentId: "g1" },
  { id: "t2", name: "Retro", kind: "thread", parentId: "g1" },
  { id: "g2", name: "Product", kind: "group" },
  { id: "d1", name: "Alice", kind: "direct" },
  { id: "d2", name: "Bob", kind: "direct" },
]

function run(tab: ChatSelectorTab, keyword: string, followed: string[] = [], recent: string[] = []) {
  return filterChatSelectorItems(
    ITEMS,
    { activeTab: tab, keyword, followedKeys: new Set(followed), recentKeys: new Set(recent) },
    acc,
  ).map((i) => i.id)
}

describe("filterChatSelectorItems — Tab 作用域", () => {
  it("group Tab 含群与子区、不含私聊，且保持树序", () => {
    expect(run("group", "")).toEqual(["g1", "t1", "t2", "g2"])
  })

  it("direct Tab 仅私聊", () => {
    expect(run("direct", "")).toEqual(["d1", "d2"])
  })

  it("followed Tab 仅关注集合命中的项（跨类型皆可）", () => {
    expect(run("followed", "", [key("group", "g2"), key("direct", "d1")])).toEqual(["g2", "d1"])
  })

  it("recent Tab 仅最近集合命中的项，保持传入顺序", () => {
    expect(run("recent", "", [], [key("group", "g1"), key("direct", "d2")])).toEqual(["g1", "d2"])
  })

  it("复合 key 跨类型不碰撞：同 id 不同类型互不干扰", () => {
    const items: TestItem[] = [
      { id: "42", name: "Group42", kind: "group" },
      { id: "42", name: "Direct42", kind: "direct" },
    ]
    const out = filterChatSelectorItems(
      items,
      { activeTab: "followed", keyword: "", followedKeys: new Set([key("direct", "42")]), recentKeys: new Set() },
      acc,
    )
    expect(out.map((i) => i.name)).toEqual(["Direct42"])
  })
})

describe("filterChatSelectorItems — 关键字过滤（方案 A）", () => {
  it("命中子区时带出父群（父群名未命中也带出）", () => {
    // 「standup」命中 t1，其父群 g1 被带出；无关的 t2/g2 不出现。
    expect(run("group", "standup")).toEqual(["g1", "t1"])
  })

  it("命中父群不强制展开其全部子区", () => {
    // 「engineering」命中群名 g1，但不把 t1/t2 一并带出。
    expect(run("group", "engineering")).toEqual(["g1"])
  })

  it("带出的父群只在当前 Tab 作用域内查找（direct Tab 无群，命中私聊不越界）", () => {
    expect(run("direct", "ali")).toEqual(["d1"])
  })

  it("关键字过滤叠加在 Tab 作用域之上（followed Tab 内再按关键字）", () => {
    // followed 命中 g1 + g2，关键字「product」只留 g2。
    expect(run("followed", "product", [key("group", "g1"), key("group", "g2")])).toEqual(["g2"])
  })

  it("关键字命中不跨类型泄漏：同 raw id 不同类型，命中其一不带出另一（复合 key 防碰撞）", () => {
    // direct:42 与 group:42 同处 recent 作用域、raw id 相同类型不同。
    const items: TestItem[] = [
      { id: "42", name: "Group42", kind: "group" },
      { id: "42", name: "Direct42", kind: "direct" },
    ]
    const out = filterChatSelectorItems(
      items,
      {
        activeTab: "recent",
        keyword: "direct42", // 只命中 direct:42
        followedKeys: new Set(),
        recentKeys: new Set([key("group", "42"), key("direct", "42")]),
      },
      acc,
    )
    // 若关键字过滤退化成裸 id 比较，group:42 会被 direct:42 的命中一并带出——此处断言不会。
    expect(out.map((i) => i.name)).toEqual(["Direct42"])
  })
})
