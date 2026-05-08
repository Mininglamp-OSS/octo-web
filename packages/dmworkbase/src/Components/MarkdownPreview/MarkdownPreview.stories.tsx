import type { Meta, StoryObj } from "@storybook/react";
import MarkdownPreview from "./index";

const meta: Meta<typeof MarkdownPreview> = {
  title: "Components/MarkdownPreview",
  component: MarkdownPreview,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof MarkdownPreview>;

// ── 短文本（无目录） ──
const shortMarkdown = `# 欢迎使用 MarkdownPreview

这是一个简单的 Markdown 预览器。

## 功能特性

- 支持 **粗体** 和 *斜体*
- 支持 \`行内代码\`
- 支持列表

\`\`\`typescript
// 代码块示例
function hello() {
  console.log("Hello, world!");
}
\`\`\`

> 引用块示例
> 多行引用

---

表格示例：

| 列1 | 列2 | 列3 |
|-----|-----|-----|
| 数据1 | 数据2 | 数据3 |
| 数据4 | 数据5 | 数据6 |
`;

// ── 长文本（有目录） ──
const longMarkdown = `# OpenClaw Agent 开发指南

欢迎使用 OpenClaw！这是一个功能强大的 AI Agent 框架。

## 快速开始

OpenClaw 提供了简单易用的 API，让你能够快速构建 AI Agent。

### 安装

使用 npm 安装 OpenClaw：

\`\`\`bash
npm install openclaw
\`\`\`

### 基础配置

创建配置文件 \`openclaw.config.js\`：

\`\`\`javascript
module.exports = {
  model: "claude-sonnet-4",
  workspace: "~/.openclaw",
};
\`\`\`

## 核心概念

OpenClaw 基于以下核心概念构建。

### Agent

Agent 是 OpenClaw 的基本单位，代表一个独立的 AI 助手。

### Session

Session 管理对话上下文，每个 Session 都有独立的记忆。

### Tool

Tool 是 Agent 可以调用的外部能力，比如搜索、计算等。

## 高级特性

掌握这些高级特性，让你的 Agent 更加强大。

### 记忆管理

OpenClaw 提供了完善的记忆管理机制：

- **短期记忆**：存储在 Session 中
- **长期记忆**：持久化到 MEMORY.md
- **向量检索**：基于语义的记忆召回

### 技能系统

技能系统让 Agent 能够学习新能力：

\`\`\`typescript
import { Skill } from "openclaw";

const weatherSkill = new Skill({
  name: "weather",
  description: "查询天气信息",
  handler: async (location: string) => {
    // 查询天气逻辑
  },
});
\`\`\`

### 多模态支持

OpenClaw 支持文本、图片、音频等多种模态：

- 📝 文本处理
- 🖼️ 图片识别
- 🎵 音频转写

## 最佳实践

遵循这些最佳实践，构建更加健壮的 Agent。

### 错误处理

始终为 Agent 提供清晰的错误处理逻辑：

\`\`\`typescript
try {
  await agent.execute(task);
} catch (error) {
  console.error("Agent 执行失败:", error);
  // 恢复逻辑
}
\`\`\`

### 性能优化

1. **减少上下文长度**：定期清理无用记忆
2. **批量处理**：合并多个请求
3. **缓存策略**：缓存常用查询结果

### 安全考虑

- ✅ 验证用户输入
- ✅ 限制 Agent 权限
- ✅ 审计敏感操作

## API 参考

完整的 API 文档请参考 [官方文档](https://docs.openclaw.ai)。

### Agent 类

\`\`\`typescript
class Agent {
  constructor(config: AgentConfig);
  execute(task: string): Promise<Result>;
  addTool(tool: Tool): void;
  reset(): void;
}
\`\`\`

### Session 类

\`\`\`typescript
class Session {
  constructor(id: string);
  addMessage(message: Message): void;
  getHistory(): Message[];
  clear(): void;
}
\`\`\`

## 社区与支持

遇到问题？我们随时为你提供帮助！

### 获取帮助

- 💬 [Discord 社区](https://discord.com/invite/openclaw)
- 📖 [官方文档](https://docs.openclaw.ai)
- 🐛 [GitHub Issues](https://github.com/openclaw/openclaw/issues)

### 贡献指南

欢迎为 OpenClaw 贡献代码！请阅读我们的 [贡献指南](https://github.com/openclaw/openclaw/blob/main/CONTRIBUTING.md)。

## 许可证

MIT License © 2026 OpenClaw Team

---

**祝你使用愉快！** 🚀
`;

// ── 技术文档示例（含数学公式） ──
const techDocMarkdown = `# 神经网络基础

## 线性回归

线性回归的损失函数为：

$$
L(w, b) = \\frac{1}{n} \\sum_{i=1}^{n} (y_i - \\hat{y}_i)^2
$$

其中 $\\hat{y}_i = wx_i + b$ 是预测值。

### 梯度下降

权重更新公式：

$$
w := w - \\alpha \\frac{\\partial L}{\\partial w}
$$

其中 $\\alpha$ 是学习率。

## 激活函数

常用的激活函数包括：

### Sigmoid

$$
\\sigma(x) = \\frac{1}{1 + e^{-x}}
$$

### ReLU

$$
\\text{ReLU}(x) = \\max(0, x)
$$

## 反向传播

链式法则：

$$
\\frac{\\partial L}{\\partial w_1} = \\frac{\\partial L}{\\partial z_3} \\cdot \\frac{\\partial z_3}{\\partial z_2} \\cdot \\frac{\\partial z_2}{\\partial w_1}
$$

---

**注意**：本文档使用 KaTeX 渲染数学公式。
`;

/**
 * 默认状态：短文本，无目录
 */
export const ShortContent: Story = {
  args: {
    content: shortMarkdown,
  },
  parameters: {
    docs: {
      description: {
        story: "短文本示例，h2 标题少于 3 个，不显示目录。",
      },
    },
  },
};

/**
 * 长文本：有目录，默认展开
 */
export const LongContentWithToc: Story = {
  args: {
    content: longMarkdown,
    defaultTocOpen: true,
  },
  parameters: {
    docs: {
      description: {
        story: "长文本示例，h2 标题 ≥ 3 个，显示左侧目录，支持点击跳转。",
      },
    },
  },
};

/**
 * 长文本：目录默认收起
 */
export const LongContentTocCollapsed: Story = {
  args: {
    content: longMarkdown,
    defaultTocOpen: false,
  },
  parameters: {
    docs: {
      description: {
        story: "长文本但目录默认收起，用户可手动展开。",
      },
    },
  },
};

/**
 * 技术文档：含数学公式
 */
export const TechnicalDocWithMath: Story = {
  args: {
    content: techDocMarkdown,
    defaultTocOpen: true,
  },
  parameters: {
    docs: {
      description: {
        story: "技术文档示例，包含 LaTeX 数学公式（通过 KaTeX 渲染）。",
      },
    },
  },
};

/**
 * 空内容
 */
export const EmptyContent: Story = {
  args: {
    content: "",
  },
  parameters: {
    docs: {
      description: {
        story: "空内容时的渲染效果。",
      },
    },
  },
};

/**
 * 仅 h3 标题（无目录）
 */
export const OnlyH3Headings: Story = {
  args: {
    content: `# 标题

### 子标题1
内容1

### 子标题2
内容2

### 子标题3
内容3
`,
  },
  parameters: {
    docs: {
      description: {
        story: "只有 h3 标题（没有 h2），不显示目录。",
      },
    },
  },
};

/**
 * 混合内容：代码、表格、引用
 */
export const MixedContent: Story = {
  args: {
    content: `# 混合内容示例

## 代码示例

\`\`\`python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
\`\`\`

## 表格示例

| 语言 | 类型 | 年份 |
|------|------|------|
| Python | 动态 | 1991 |
| TypeScript | 静态 | 2012 |
| Rust | 静态 | 2010 |

## 引用示例

> "Talk is cheap. Show me the code."
> 
> — Linus Torvalds

## 列表示例

- **无序列表**
  - 嵌套项目1
  - 嵌套项目2
- 其他项目

1. **有序列表**
   1. 子项目A
   2. 子项目B
2. 下一项

## 任务列表

- [x] 完成 MarkdownPreview 组件
- [x] 编写 Storybook 故事
- [ ] 添加单元测试

---

**完成！**
`,
    defaultTocOpen: true,
  },
  parameters: {
    docs: {
      description: {
        story: "包含代码块、表格、引用、列表等多种 Markdown 元素的混合内容。",
      },
    },
  },
};
