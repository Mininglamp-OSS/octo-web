# DMWork 前端开发规范

> 适用于所有开发 Agent（织码、览境、审之等）
> 违反以下规则的 PR 不予合并
> 基于 Vite 8 + pnpm 10 + React 18（2026-03-27 更新）

---

## 一、环境要求

| 工具 | 版本 | 说明 |
|---|---|---|
| Node.js | 20.x | 推荐 nvm 管理 |
| pnpm | 10.x | **必须用 pnpm，不要用 yarn/npm** |

```bash
pnpm install  # 安装依赖
pnpm dev      # 启动开发服务器
pnpm build    # 生产构建
pnpm lint     # Lint
```

---

## 二、Token 使用规范

### 禁止硬编码

```css
/* ❌ 禁止 */
color: #7C5CFC;
background: white;
padding: 8px;
border-radius: 4px;
font-size: 14px;

/* ✅ 正确 */
color: var(--wk-brand-primary);
background: var(--wk-bg-surface);
padding: var(--wk-sp-2);
border-radius: var(--wk-r-xs);
font-size: var(--wk-text-size-md);
```

### Token 分层（禁止跨层引用）

```
primitive.css  → 原始调色板，禁止在组件里直接用
semantic.css   → 语义层，组件里用这一层
component.css  → 组件专属变量（待补充）
```

### ⚠️ Vite 跨包 CSS @import 坑

**在 Vite 下，JS/TS 里 `import` CSS 文件时，该 CSS 文件里的 `@import` 链不会被递归展开。**

```ts
// ❌ 错误：index.css 里的 @import primitive.css 不会生效
import '../../../packages/dmworkbase/src/theme/index.css'

// ✅ 正确：在 preview.ts 里直接 import 每个文件
import '../../../packages/dmworkbase/src/theme/primitive.css'
import '../../../packages/dmworkbase/src/theme/semantic.css'
```

或者在 `vite.config.ts` / `viteFinal` 里加 `postcss-import` 插件（编译时展开）：

```ts
import postcssImport from 'postcss-import'

viteFinal: (config) => mergeConfig(config, {
  css: { postcss: { plugins: [postcssImport()] } }
})
```

### 主题切换

- 项目用 `body[theme-mode=dark]` 切换暗色
- 禁止用 `@media (prefers-color-scheme: dark)` 做主题
- 禁止在暗色样式里硬编码颜色

---

## 三、组件分层规则

### 新组件：按决策树判断

```
这个组件知道业务数据吗？（Channel / Message / User / WKSDK）
├── 是 → Layer 3 业务组件（暂不重构）
└── 否 → 它依赖其他非 Semi 组件吗？
          ├── 是 → Layer 2 复合组件
          └── 否 → Layer 1 原子组件（默认起点）
```

开发过程中层级可以升，不能降：
- 发现需要引入其他组件 → 升到 Layer 2
- 发现需要调接口/读全局状态 → 移到 Layer 3

### 现有组件：用扫描数据判断

```bash
grep "^import" packages/dmworkbase/src/Components/ComponentName/index.tsx \
  | grep -v "react\|semi\|css\|png" | wc -l

# 依赖数 0   → Layer 1
# 依赖数 1-4 → Layer 2
# 依赖数 5+  → Layer 3
```

### 依赖方向（只允许向下）

```
✅ Layer 3 → Layer 2 → Layer 1 → Semi / React
❌ Layer 1 import Layer 2（原子不能依赖复合）
❌ 同层互相 import
```

### Semi Design 使用规则

```tsx
// Layer 1 ✅ — 封装 Semi，暴露自己的 props
const WKButton: React.FC<WKButtonProps> = ({ variant, ...rest }) => { ... }

// Layer 2 ✅ — 用 Layer 1，不直接用 Semi Button
import WKButton from '../WKButton'

// Layer 3 ✅ — 允许直接用 Semi，优先用 WK 封装版
import { Notification } from '@douyinfe/semi-ui'

// ❌ 任何层 — 禁止直接用 Semi 基础交互组件
import { Button } from '@douyinfe/semi-ui'  // 用 WKButton 代替
import { Checkbox } from '@douyinfe/semi-ui' // 用 Checkbox（本项目版）代替
```

### 当前各层组件清单

```
Layer 1 原子组件：
  AiBadge / Search / WKButton / Checkbox / IconClick / InputEdit

Layer 2 布局/复合组件：
  WKNavHeader / WKAvatar / WKViewQueue / WKViewQueueHeader / WKLayout

Layer 3 业务组件（暂不重构）：
  Conversation / ConversationList / MessageInput / UserInfo / ChannelSetting
```

---

## 四、新组件开发流程

### Step 1：确认分层（30秒）

用上面的决策树判断是 Layer 1/2/3。

### Step 2：查 MCP，确认没有现成的

Storybook 跑着时，MCP server 在 `http://localhost:6006/mcp`。
连上后可以查询：「有没有类似 XXX 的组件？」

### Step 3：标准文件结构

```
packages/dmworkbase/src/Components/ComponentName/
├── index.tsx                    ← 组件实现
├── index.css                    ← 样式（全部用 var(--wk-*) token）
└── ComponentName.stories.tsx    ← Stories（和组件同步写）
```

### Step 4：index.tsx 铁律

```tsx
// ✅ 必须同时有 default export 和 named export
const MyComponent: React.FC<MyComponentProps> = ({ ...props }) => {
  return <div>...</div>
}

export default MyComponent
export { MyComponent }  // 兼容有些地方用具名 import
```

### Step 5：Stories 必须覆盖

```tsx
export const Default: Story = { ... }       // 默认状态
export const AllVariants: Story = { ... }   // 所有 variant/size
export const States: Story = { ... }        // disabled/loading/error
export const EdgeCases: Story = { ... }     // 长文本/空值/极端数值
// 亮/暗主题用全局切换按钮验证，不需要单独 story
```

### Step 6：commit 前验证清单

```bash
# 1. Storybook 里所有 story 正常渲染，无报错

# 2. Console 验证 token 加载成功（空字符串 = token 没生效）
getComputedStyle(document.body).getPropertyValue('--wk-purple-500')
# 应返回：#7C5CFC

# 3. 切换亮/暗主题，组件样式跟着变

# 4. 扫调用方影响（改造现有组件时）
grep -rn "ComponentName" packages/ apps/ --include="*.tsx" --include="*.css" -l

# 5. 确认改动文件数合理
git diff --stat
# 超过 10 个文件要警觉

# 6. 禁止 push，禁止开 PR/MR
```

---

## 五、改造现有组件规范

### class 名变更流程

1. 搜索旧 class 名所有引用（CSS + TSX）
2. 同步更新所有引用
3. 验证主项目功能正常
4. 才能提交

```bash
grep -rn "旧class名" packages/ apps/ --include="*.tsx" --include="*.css"
```

### Props 变更规范

- 改了 prop 名要加 `@deprecated` 注释，旧 prop 保留兼容一段时间
- `onCheck` → `onChange` 这类变更，两个都保留，旧的标注 deprecated
- 不能只改组件，不改调用方

### 禁止

- ❌ 同时保留新旧两个 class（临时兼容可以，但必须同一 PR 彻底迁移）
- ❌ 改了组件不验证主项目
- ❌ 假设「只有 Storybook 用这个组件」

---

## 六、Storybook 规范

### 启动

```bash
# 主仓库（pnpm + Vite 8）
cd apps/web && pnpm storybook  # http://localhost:6006

# MCP Server（供 Agent 查询组件）
http://localhost:6006/mcp
```

### Story 写法

```tsx
// ✅ import 用 @storybook/react-vite（不是 react-webpack5）
import type { Meta, StoryObj } from '@storybook/react-vite'
import React from 'react'

const meta: Meta<typeof Component> = {
  title: 'Base/ComponentName',  // Layer 1 用 Base/，Layer 2 用 Layout/
  parameters: {
    docs: {
      description: {
        component: '组件说明 + ⚠️ 使用注意事项（禁止用法）'
      }
    }
  }
}
```

### Story 文件 tsconfig 排除

Stories 文件已在主项目 `tsconfig.json` 里 exclude，不会被主项目 tsc 扫到。不需要手动处理。

---

## 七、Git 规范

- 身份：`sosoclaw / sosoclaw@openclaw.local`
- 分支命名：`feat/sosoclaw/description`、`fix/sosoclaw/description`
- **禁止 push，禁止开 PR/MR**，除非明确指示
- commit 前用 `git diff --stat` 确认改动文件数，超过 10 个要警觉
- **不要提交 `yarn.lock`**，项目用 `pnpm-lock.yaml`

---

## 八、派任务标准格式

织码接到组件任务时，任务描述必须包含：

```
组件名：ComponentName
文件位置：packages/dmworkbase/src/Components/ComponentName/
Layer：1 / 2 / 3
复用组件：[列出要用到的已有组件，先查 MCP 确认]
Props：
  - propName: type（说明，必填/选填）
交互：[描述交互行为]
边界条件：
  - [边界情况1]
  - [边界情况2]
Token 约束：[必须用的 token 变量，如 --wk-brand-primary]
禁止修改：[不能动的文件列表]
禁止行为：禁止 push，禁止开 PR/MR
```

---

## 九、环境变量 & 资源规范

### 环境变量格式（CRA → Vite）

```tsx
// ❌ 旧写法
process.env.REACT_APP_API_URL

// ✅ 新写法
import.meta.env.VITE_API_URL
import.meta.env.DEV   // 替代 NODE_ENV === 'development'
import.meta.env.PROD  // 替代 NODE_ENV === 'production'
```

### 资源引用（禁止 require）

```tsx
// ❌ 旧写法
src={require("./assets/icon.png")}

// ✅ 新写法
import icon from "./assets/icon.png"
src={icon}
```

---

## 十、已知坑

| 坑 | 现象 | 解决方案 |
|---|---|---|
| Vite 跨包 CSS @import 链失效 | token 变量为空字符串 | preview.ts 直接 import 每个 CSS 文件，或用 postcss-import |
| pnpm 幽灵依赖 | 运行时 Module not found | 在 package.json 显式声明，或加到 .npmrc public-hoist-pattern |
| stories 被主项目 tsc 扫到 | TS 报错 moduleResolution | tsconfig.json exclude stories 和 .storybook |
| class component 在 StrictMode 下副作用双调用 | React 18 StrictMode 特性 | 改函数组件 + useEffect |
| WKButton/InputEdit 缺 default export | story 渲染报错 | index.tsx 必须同时有 default 和 named export |
