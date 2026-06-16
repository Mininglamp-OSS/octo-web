import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import ReplyBlock from "./index";

const meta: Meta<typeof ReplyBlock> = {
  title: "ui/message/ReplyBlock",
  component: ReplyBlock,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 320, padding: 20, background: "#fff" }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ReplyBlock>;

/** 本 Space 成员：仅昵称 + 摘要，无 `@SpaceName` 后缀 */
export const Default: Story = {
  args: {
    fromName: "嘉伟qq",
    digest: "hello",
  },
};

/**
 * 外部 Space 成员：昵称后追加 `@SpaceName` 企微风格来源标记。
 *
 * 对应 dmwork-web#1069（Round 3）：
 * `message.content.reply` 由 SDK `Reply.prototype.decode` monkey-patch
 * 透传 `from_home_space_*` / legacy `from_*` 字段后，`Text/index.tsx`
 * 通过 `resolveExternalForViewer` 解析出 `sourceSpaceName` 传入本组件。
 * 这个 story 是唯一在 UI 层验证后缀确实上屏的入口 —— 若 UI 回退到仅读
 * `fromName`，该 story 会与 Default 视觉一致，Storybook 手检或快照会失败。
 */
export const ExternalSender: Story = {
  args: {
    fromName: "嘉伟qq",
    digest: "hello",
    sourceSpaceName: "测试空间1",
  },
};

/** 长 SpaceName：单行截断 */
export const LongSpaceName: Story = {
  args: {
    fromName: "Alice Longname",
    digest:
      "This is a very long quoted digest that should be truncated after one line",
    sourceSpaceName:
      "A very very long external workspace name for truncation demo",
  },
};

/** 摘要中的链接：高亮并可点击，不影响点击引用块定位原消息 */
export const LinkDigest: Story = {
  args: {
    fromName: "沈鑫",
    digest: "图文混排摘要 https://example.com/docs 后面还有文字",
  },
};
