import type { Meta, StoryObj } from "@storybook/react-vite";
import React from "react";
import ChangelogMarkdown from "./ChangelogMarkdown";
import "./index.css";
import "../../theme/index.css";

const meta: Meta<typeof ChangelogMarkdown> = {
    title: "Navigation/ChangelogMarkdown",
    component: ChangelogMarkdown,
    args: {
        content: [
            "## 2026.07.22",
            "",
            "**新增**",
            "",
            "- 更新日志支持 Markdown 列表",
            "- 链接会在新窗口安全打开：[查看帮助](https://example.com/help)",
            "- 行内代码示例：`pnpm build`",
        ].join("\n"),
    },
    decorators: [
        (Story) => (
            <div style={{ width: 480, padding: 24, background: "var(--wk-bg-surface)" }}>
                <Story />
            </div>
        ),
    ],
    parameters: {
        docs: {
            description: {
                component: "设置面板更新说明使用的受限 Markdown 渲染器；原始 HTML 和非 http/https 链接不会渲染。",
            },
        },
    },
};

export default meta;
type Story = StoryObj<typeof ChangelogMarkdown>;

export const Default: Story = {};
