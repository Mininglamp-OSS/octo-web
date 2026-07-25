import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import ResizableRightPanel from "./index";

const size = {
  minWidth: 360,
  defaultWidth: 480,
  maxWidth: 720,
  storageKey: "storybook-resizable-right-panel",
};

const meta: Meta<typeof ResizableRightPanel> = {
  title: "Base/ResizableRightPanel",
  component: ResizableRightPanel,
  parameters: {
    docs: {
      description: {
        component:
          "通用右侧面板壳：支持左边缘拖拽、双击恢复默认宽度、Escape/关闭按钮。业务内容通过 children 注入。",
      },
    },
  },
};

export default meta
type Story = StoryObj<typeof ResizableRightPanel>;

export const Default: Story = {
  name: "默认",
  args: {
    title: "消息预览",
    closeLabel: "关闭预览",
    onClose: () => undefined,
    size,
    children: <div style={{ padding: "var(--wk-sp-4)" }}>面板内容</div>,
  },
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ position: "relative", height: 560, overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
};

export const LongContent: Story = {
  ...Default,
  name: "长内容",
  args: {
    ...Default.args,
    children: (
      <div style={{ padding: "var(--wk-sp-4)", overflowWrap: "anywhere" }}>
        {Array.from({ length: 18 }, (_, index) => (
          <p key={index}>
            第 {index + 1} 段内容：用于验证窄宽度、滚动和长文本布局。
          </p>
        ))}
      </div>
    ),
  },
};

export const NarrowOverlay: Story = {
  ...Default,
  name: "窄窗口覆盖模式",
  decorators: [
    (Story: React.ComponentType) => (
      <div
        style={{
          position: "relative",
          width: 620,
          maxWidth: "100%",
          height: 560,
          overflow: "hidden",
        }}
      >
        <Story />
      </div>
    ),
  ],
};
