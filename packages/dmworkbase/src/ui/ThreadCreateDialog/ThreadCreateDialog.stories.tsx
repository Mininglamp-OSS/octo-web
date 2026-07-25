import React, { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react-vite"
import ThreadCreateDialog, { ThreadCreateForm, ThreadCreateLabels } from "./index"

const labels: ThreadCreateLabels = {
  cancel: "取消",
  create: "创建",
  creating: "创建中...",
  maxLength: "话题名称不能超过 20 个字符",
  nameRequired: "请输入话题名称",
}

const meta: Meta<typeof ThreadCreateDialog> = {
  title: "UI/ThreadCreateDialog",
  component: ThreadCreateDialog,
  parameters: { layout: "centered" },
}

export default meta
type Story = StoryObj<typeof ThreadCreateDialog>

export const Default: Story = {
  render: () => {
    const [visible, setVisible] = useState(true)
    return (
      <ThreadCreateDialog
        visible={visible}
        title="创建子区"
        label="话题名称"
        placeholder="输入讨论话题..."
        labels={labels}
        maxLength={20}
        onSubmit={() => undefined}
        onCancel={() => setVisible(false)}
      />
    )
  },
}

export const InlineForm: StoryObj<typeof ThreadCreateForm> = {
  render: () => (
    <div style={{ width: 360, padding: "var(--wk-sp-4)", background: "var(--wk-bg-surface)" }}>
      <ThreadCreateForm
        label="话题名称"
        placeholder="输入讨论话题..."
        labels={labels}
        maxLength={20}
        onSubmit={() => undefined}
        onCancel={() => undefined}
      />
    </div>
  ),
}

export const WithInitialValue: Story = {
  args: {
    visible: true,
    title: "创建子区",
    label: "话题名称",
    placeholder: "输入讨论话题...",
    initialValue: "根据这条消息讨论",
    labels,
    maxLength: 20,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
}

export const Loading: Story = {
  args: {
    visible: true,
    title: "创建子区",
    label: "话题名称",
    placeholder: "输入讨论话题...",
    initialValue: "项目排期讨论",
    labels,
    loading: true,
    maxLength: 20,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
}

export const ErrorState: Story = {
  args: {
    visible: true,
    title: "创建子区",
    label: "话题名称",
    placeholder: "输入讨论话题...",
    initialValue: "项目排期讨论",
    labels,
    error: "创建失败，请稍后重试",
    maxLength: 20,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
}

export const LongValue: Story = {
  args: {
    visible: true,
    title: "创建子区",
    label: "话题名称",
    placeholder: "输入讨论话题...",
    initialValue: "这是一个超过长度限制的子区话题名称",
    labels,
    maxLength: 10,
    onSubmit: () => undefined,
    onCancel: () => undefined,
  },
}
