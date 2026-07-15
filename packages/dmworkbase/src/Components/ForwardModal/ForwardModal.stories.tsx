import React, { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { userEvent, within, expect } from "@storybook/test"
import { ForwardModal, ForwardItem } from "./ForwardModal"
import type { ForwardModalProps } from "./ForwardModal"

const meta: Meta<typeof ForwardModal> = {
  title: "Components/ForwardModal",
  component: ForwardModal,
  parameters: {
    layout: "centered",
  },
}

export default meta
type Story = StoryObj<typeof ForwardModal>

// ---- mock 数据 ----

const mockItems: ForwardItem[] = [
  {
    channelID: "user-001",
    channelType: 1,
    displayName: "Alice",
  },
  {
    channelID: "user-002",
    channelType: 1,
    displayName: "Bob",
  },
  {
    channelID: "group-001",
    channelType: 2,
    displayName: "前端开发群",
    hasThreads: true,
  },
  {
    channelID: "group-002",
    channelType: 2,
    displayName: "产品讨论组",
    hasThreads: false,
  },
  {
    channelID: "thread-001",
    channelType: 5, // ChannelTypeCommunityTopic
    displayName: "产品周会 #公告",
    isThread: true,
  },
  {
    channelID: "bot-001",
    channelType: 1,
    displayName: "哇哈哈助手",
    isAI: true,
  },
]

/** 树状展示 mock：父群 → 子区缩进紧跟 */
const mockTreeItems: ForwardItem[] = [
  {
    channelID: "user-001",
    channelType: 1,
    displayName: "Alice",
  },
  {
    channelID: "group-001",
    channelType: 2,
    displayName: "前端开发群",
    hasThreads: true,
  },
  {
    channelID: "thread-001",
    channelType: 5,
    displayName: "需求讨论",
    isThread: true,
    parentChannelID: "group-001",
  },
  {
    channelID: "thread-002",
    channelType: 5,
    displayName: "Bug 追踪",
    isThread: true,
    parentChannelID: "group-001",
  },
  {
    channelID: "group-002",
    channelType: 2,
    displayName: "产品讨论组",
    hasThreads: true,
  },
  {
    channelID: "thread-003",
    channelType: 5,
    displayName: "版本规划",
    isThread: true,
    parentChannelID: "group-002",
  },
  {
    channelID: "group-003",
    channelType: 2,
    displayName: "运营群",
    hasThreads: false,
  },
  {
    channelID: "bot-001",
    channelType: 1,
    displayName: "哇哈哈助手",
    isAI: true,
  },
]

// ---- 可交互 wrapper ----

function Interactive(props: Partial<ForwardModalProps> & { initialItems?: ForwardItem[] }) {
  const baseItems = props.initialItems ?? mockItems
  const [selectedIDs, setSelectedIDs] = useState<string[]>(props.selectedIDs ?? [])
  const [inputValue, setInputValue] = useState(props.inputValue ?? "")
  const [keyword, setKeyword] = useState(props.inputValue ?? "")

  // 过滤后的列表（列表项）
  const items = baseItems.filter((item: ForwardItem) =>
    keyword === ""
      ? true
      : item.displayName.toLowerCase().includes(keyword.toLowerCase())
  )
  // 全量列表（头像区，不受搜索影响）
  const allItems = baseItems

  const handleInputChange = (val: string) => {
    setInputValue(val)
    // 在 Story 里即时更新（不加 debounce，方便 play function 断言）
    setKeyword(val)
  }

  return (
    <div style={{ width: 400, border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <ForwardModal
        {...props}
        items={items}
        allItems={allItems}
        selectedIDs={selectedIDs}
        inputValue={inputValue}
        onInputChange={handleInputChange}
        onToggleSelect={(item: ForwardItem) => {
          setSelectedIDs((prev: string[]) =>
            prev.includes(item.channelID)
              ? prev.filter((id: string) => id !== item.channelID)
              : [...prev, item.channelID]
          )
        }}
        onConfirm={() => {}}
        onCancel={props.onCancel}
        activeTab={props.activeTab ?? "recent"}
        onTabChange={props.onTabChange ?? (() => {})}
      />
    </div>
  )
}

// ---- Stories ----

/** 默认：有列表，未选中任何人。验证列表渲染 + 点击选中行为 */
export const Default: Story = {
  render: () => <Interactive />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 列表有数据
    await expect(canvas.getByText("Alice")).toBeInTheDocument()
    await expect(canvas.getByText("Bob")).toBeInTheDocument()

    // 确认按钮初始 disabled
    const confirmBtn = canvas.getByRole("button", { name: /确认/i })
    await expect(confirmBtn).toBeDisabled()

    // 点击 Alice → 选中，确认按钮变为可点
    await userEvent.click(canvas.getByText("Alice"))
    await expect(canvas.getByRole("button", { name: /确认\(1\)/i })).not.toBeDisabled()

    // 再次点击 Alice → 取消选中，确认按钮回到 disabled
    await userEvent.click(canvas.getByText("Alice"))
    await expect(canvas.getByRole("button", { name: /确认/i })).toBeDisabled()
  },
}

/** 已选多人：头像区显示 + 确认按钮计数正确 */
export const WithSelected: Story = {
  render: () => <Interactive selectedIDs={["user-001", "group-001", "bot-001"]} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 确认按钮显示已选数量
    await expect(canvas.getByRole("button", { name: /确认\(3\)/i })).toBeInTheDocument()

    // 点击已选项目取消
    await userEvent.click(canvas.getByText("Alice"))
    await expect(canvas.getByRole("button", { name: /确认\(2\)/i })).toBeInTheDocument()
  },
}

/** 搜索过滤：输入关键字后列表被过滤 */
export const SearchFiltered: Story = {
  render: () => <Interactive />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 初始有 Alice 和 Bob
    await expect(canvas.getByText("Alice")).toBeInTheDocument()
    await expect(canvas.getByText("Bob")).toBeInTheDocument()

    // 搜索「群」
    const input = canvas.getByPlaceholderText("搜索")
    await userEvent.clear(input)
    await userEvent.type(input, "群")

    // Alice/Bob 消失，群相关显示
    await expect(canvas.queryByText("Alice")).not.toBeInTheDocument()
    await expect(canvas.getByText("前端开发群")).toBeInTheDocument()

    // 清空搜索恢复
    await userEvent.clear(input)
    await expect(canvas.getByText("Alice")).toBeInTheDocument()
  },
}

/** 空列表：items 为空时显示空状态文案 */
export const EmptyList: Story = {
  render: () => <Interactive initialItems={[]} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("暂无联系人")).toBeInTheDocument()
  },
}

/** loading 状态：显示加载中文案 */
export const Loading: Story = {
  render: () => (
    <div style={{ width: 400, border: "1px solid #eee", borderRadius: 8, overflow: "hidden" }}>
      <ForwardModal
        items={[]}
        selectedIDs={[]}
        inputValue=""
        loading={true}
        onInputChange={() => {}}
        onToggleSelect={() => {}}
        onConfirm={() => {}}
        activeTab="recent"
        onTabChange={() => {}}
      />
    </div>
  ),
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText("加载中…")).toBeInTheDocument()
  },
}

/** 树状展示：父群下子区缩进显示，群聊和子区独立勾选 */
export const TreeView: Story = {
  render: () => <Interactive initialItems={mockTreeItems} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 父群和子区都在列表里
    await expect(canvas.getByText("前端开发群")).toBeInTheDocument()
    await expect(canvas.getByText("需求讨论")).toBeInTheDocument()
    await expect(canvas.getByText("Bug 追踪")).toBeInTheDocument()
    await expect(canvas.getByText("产品讨论组")).toBeInTheDocument()
    await expect(canvas.getByText("版本规划")).toBeInTheDocument()

    // 选中父群，不影响子区
    await userEvent.click(canvas.getByText("前端开发群"))
    await expect(canvas.getByRole("button", { name: /确认\(1\)/i })).toBeInTheDocument()

    // 再选中子区，两者独立
    await userEvent.click(canvas.getByText("需求讨论"))
    await expect(canvas.getByRole("button", { name: /确认\(2\)/i })).toBeInTheDocument()

    // 取消父群，子区仍选中
    await userEvent.click(canvas.getByText("前端开发群"))
    await expect(canvas.getByRole("button", { name: /确认\(1\)/i })).toBeInTheDocument()
  },
}

/** 树状连接线可见：父群下子区有 └─ 折角线 */
export const TreeViewWithLines: Story = {
  render: () => <Interactive initialItems={mockTreeItems} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)
    // 子区在列表里（连接线由 CSS 渲染，play function 验证结构正确即可）
    await expect(canvas.getByText("需求讨论")).toBeInTheDocument()
    await expect(canvas.getByText("Bug 追踪")).toBeInTheDocument()
    await expect(canvas.getByText("版本规划")).toBeInTheDocument()
  },
}

// SelectedAreaBadges story removed — badge 角标已按设计稿去掉，不再区分群聊/子区

/** 搜索方案 A：命中子区时带出父群 */
export const SearchTreeViewA: Story = {
  render: () => <Interactive initialItems={mockTreeItems} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 搜索子区名「需求」
    const input = canvas.getByPlaceholderText("搜索")
    await userEvent.clear(input)
    await userEvent.type(input, "需求")

    // 命中「需求讨论」，其父群「前端开发群」也应带出
    await expect(canvas.getByText("需求讨论")).toBeInTheDocument()
    await expect(canvas.getByText("前端开发群")).toBeInTheDocument()

    // 不相关的群/子区不显示
    await expect(canvas.queryByText("产品讨论组")).not.toBeInTheDocument()
    await expect(canvas.queryByText("版本规划")).not.toBeInTheDocument()

    // 清空搜索，所有项恢复
    await userEvent.clear(input)
    await expect(canvas.getByText("产品讨论组")).toBeInTheDocument()
    await expect(canvas.getByText("运营群")).toBeInTheDocument()
  },
}

// ─── 外部群 Tag ──────────────────────────────────────

/** 外部群 Tag：外部群 item 显示紫色「外部」标签，内部群不显示 */
const mockExternalItems: ForwardItem[] = [
  {
    channelID: "group-internal",
    channelType: 2,
    displayName: "内部产品群",
  },
  {
    channelID: "group-external",
    channelType: 2,
    displayName: "外部合作群",
    isExternal: true,
  },
  {
    channelID: "user-alice",
    channelType: 1,
    displayName: "Alice",
    isExternal: true, // 私聊带 isExternal 不应展示 Tag（仅群聊显示）
  },
]

export const ExternalGroupTag: Story = {
  render: () => <Interactive initialItems={mockExternalItems} />,
  play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const canvas = within(canvasElement)

    // 三项都出现
    await expect(canvas.getByText("内部产品群")).toBeInTheDocument()
    await expect(canvas.getByText("外部合作群")).toBeInTheDocument()
    await expect(canvas.getByText("Alice")).toBeInTheDocument()

    // 外部群有「外部」Tag，内部群没有
    const externalTags = canvas.getAllByText("外部")
    await expect(externalTags.length).toBe(1)

    // Tag class 应复用 wk-conversationlist-item-external-tag
    const externalRow = canvas.getByText("外部合作群").closest(".wk-fm-item")
    await expect(
      externalRow?.querySelector(".wk-conversationlist-item-external-tag")
    ).toBeTruthy()

    // 内部群 row 没有外部 Tag
    const internalRow = canvas.getByText("内部产品群").closest(".wk-fm-item")
    await expect(
      internalRow?.querySelector(".wk-conversationlist-item-external-tag")
    ).toBeNull()

    // 私聊（Alice, channelType=1）即使 isExternal=true 也不应展示 Tag
    const aliceRow = canvas.getByText("Alice").closest(".wk-fm-item")
    await expect(
      aliceRow?.querySelector(".wk-conversationlist-item-external-tag")
    ).toBeNull()
  },
}
