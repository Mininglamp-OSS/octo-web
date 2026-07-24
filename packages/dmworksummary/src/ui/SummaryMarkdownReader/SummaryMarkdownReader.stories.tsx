import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import SummaryMarkdownReader from ".";

const meta: Meta<typeof SummaryMarkdownReader> = {
    title: "Summary/SummaryMarkdownReader",
    component: SummaryMarkdownReader,
    args: {
        outlineLabel: "本文目录",
        content: `# 智能总结 Markdown 完整渲染

这是一份用于核对 Markdown 阅读体验的完整示例，包含**粗体结论**、*补充说明*、***粗斜体重点***与~~失效方案~~。

## 正文、换行与强调

第一行用于描述当前结论。
第二行用于验证换行与[普通链接](https://github.com/Mininglamp-OSS/octo-web)。

> **群聊原话：** 正文层级已经稳定，可以继续验证复杂 Markdown 内容。
>
> > 嵌套引用用于保留回复关系，但视觉权重应低于直接引用。

### 多级标题与嵌套列表

- 正文渲染
  - 标题、段落、引用块与分隔线
  - 图片、链接和行内代码
- 复杂结构
  1. 检查多级列表缩进
  2. 检查长内容换行

---

## 表格

| 模块 | 当前状态 | 负责人 | 完成度 |
| :--- | :---: | ---: | ---: |
| Markdown 正文 | 已完成 | Web | 100% |
| 引用消息 | 联调中 | Summary | 80% |
| 超长内容换行能力验证 | 正常换行且窄屏横向滚动 | QA | 90% |

## 代码与任务列表

行内代码使用 \`summaryTheme\` 展示。

\`\`\`ts
const summaryTheme = {
  text: "var(--wk-text-primary)",
  ai: "var(--wk-ai-surface)",
};
\`\`\`

- [x] 标题与正文
- [x] 表格与引用
- [ ] 脚注和窄屏回归

兼容性说明通过脚注补充[^1]。

[^1]: 脚注区域应与正文通过分隔线区分。`,
        citations: [],
    },
    decorators: [(Story) => <div style={{ padding: "var(--wk-sp-6)", background: "var(--wk-bg-surface)" }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof SummaryMarkdownReader>;
export const Default: Story = {};
