# DMWork 前端开发规范

> 基于 Vite 8 + pnpm 10 + React 18（2026-03-27 更新）

## 快速查阅

| 当前任务 | 读这些章节 |
|---------|-----------|
| 写新组件 | 二、三、四、十一 |
| 改造现有组件 | 二、三、五 |
| 做代码审查 | 二、三、十一 |
| 配置 Storybook/测试 | 六 |
| 提交/分支管理 | 七 |
| 做视觉审查 | 二、十二 |
| 新增业务能力/调整模块边界 | 先读“模块边界与代码落点”，再按二、三、四、五判断实现方式 |
| 新增/改造接口调用 | 先读“API Service 分层规则”，再按对应模块补测试 |

不需要读全部，按任务找对应章节即可。

---

## 模块边界与代码落点

新增或调整业务能力时，先判断它属于哪个模块、是否已有用户入口、是否应该复用共享能力。

### 基本原则

- 新功能优先放到职责清晰的模块目录，不要只因为历史代码方便就继续追加到 `Components/`、`Messages/` 或 `packages/dmwork*`。
- `Components/`、`Messages/` 和共享服务适合承载可复用能力、兼容维护和基础设施，不应承载新的完整业务流程。
- 共享组件要保持业务无关；如果组件需要直接读业务接口、全局状态或路由上下文，它通常不是共享组件。
- 同一业务能力只能有一个用户可见入口；实现时可以重构、抽 adapter 或复用组件，但不要暴露两套路由、菜单或按钮。
- 修改共享层时，需要说明影响范围，并补充能够覆盖主要调用方的测试或 Story。

### 推荐落点

| 改动类型 | 推荐落点 | 要求 |
|---|---|---|
| 新业务页面或完整流程 | 对应业务模块目录 | 明确入口、数据来源和测试方式 |
| 可复用 UI 原子/复合组件 | `ui/` 或既有组件库 | 先写 Story，遵守 token 和分层规则 |
| 数据桥接或 hook | 对应模块的 `bridge/` 或既有 bridge 层 | types 与 hook 分离，避免 UI 直接拼接口 |
| 消息渲染能力 | `Messages/` 或消息相关模块 | 保持 renderer 边界清晰，补充消息样例 |
| 跨模块基础能力 | 基础服务或共享工具层 | 不反向依赖具体业务模块 |

### 提交前自查

- 是否新增了用户入口？如果是，是否与已有入口重复？
- 是否修改了共享组件或基础服务？如果是，是否说明影响范围？
- 是否把完整业务流程写进了通用组件目录？
- 是否补了测试、Story 或必要文档？

## API Service 分层规则

新增接口调用或改造现有接口调用时，优先把 HTTP 边界收口到 `Service/`，不要让 UI 组件、页面组件或 VM 直接拼接口。

### 基本原则

- 新增接口默认放到 `packages/dmworkbase/src/Service/*Service.ts`，按业务实体命名，例如 `UserService`、`FollowService`。
- Service 层负责拼 endpoint、query/body、响应 envelope 兼容和接口类型；组件/VM 负责页面状态、交互流程和错误展示。
- Service 层使用 `APIClient.shared`；不要在 Service 层 import `WKApp`。需要登录态、space、路由等运行时上下文时，由调用方传入必要参数。
- 新代码不要在 `Components/`、`Pages/`、`Messages/` 里直接调用 `WKApp.apiClient` 或 `APIClient.shared`。改造老代码时按模块逐步迁移，不要求一次性清空历史调用。
- Service 方法命名用业务语义，不用 HTTP 动词堆叠；例如 `getUserProfile(uid, groupNo)` 比 `getUsersByUid()` 更清楚。
- 类型优先放在对应 Service 文件里导出；多个模块共享且稳定后，再考虑移动到公共 types 文件。

### 推荐写法

```ts
// Service/UserService.ts
import APIClient from "./APIClient"

export interface UserProfile {
  uid?: string
  name?: string
  vercode?: string
  [key: string]: any
}

const UserService = {
  getUserProfile(uid: string, groupNo?: string): Promise<UserProfile> {
    return APIClient.shared.get(`users/${uid}`, {
      param: { group_no: groupNo || "" },
    })
  },
}

export default UserService
```

```ts
// Components/UserInfo/vm.tsx
const profile = await UserService.getUserProfile(uid, groupNo)
```

### 测试要求

- 新增 Service 方法时，至少补 Service 单测，覆盖 endpoint、query/body 和关键响应兼容逻辑。
- 如果改动会影响页面状态、缓存、重试、乐观更新或错误提示，还需要补 VM/组件测试。
- 迁移已有接口时，保持接口路径、参数和错误语义不变；除非 PR 明确声明并验证行为变更。
- PR 描述里写清楚影响范围：只改接口边界、还是同时改了业务行为。

### 提交前自查

- Service 是否只依赖 `APIClient.shared` 和纯工具函数？
- 调用方是否只传必要参数，而不是把 `WKApp` 或整块全局状态传进 Service？
- 是否避免把未上线、不可人工验证的功能作为唯一改造样板？
- 是否有一条可人工验证的用户路径？

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

### ⚠️ Vite 跨包 CSS @import 坑（已解决）

**问题：** 在 Vite 下，JS/TS `import` CSS 文件时，该文件里的 `@import` 链不会被递归展开，导致跨包的 token 变量全部为空。

**现在的解法：** `viteFinal` 里已配置 `postcss-import` 插件，编译时展开 `@import` 链，行为和 webpack css-loader 一致。

```ts
// viteFinal 里已有，不需要手动处理
css: { postcss: { plugins: [postcssImport()] } }
```

所以 preview.ts 里只需要 import 入口文件：
```ts
// ✅ 正确，postcss-import 会自动展开 @import 链
import '../../../packages/dmworkbase/src/theme/index.css'
```

**注意：** 如果新建了 Vite 项目或独立工具，没有这个配置时会遇到同样问题，解法是加 `postcss-import`。

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
  WKInput / SpaceAvatar / ActionListItem

Layer 2 布局/复合组件：
  WKNavHeader / WKAvatar / WKViewQueue / WKViewQueueHeader / WKLayout
  SpaceItem / JoinSpaceModal

Layer 3 业务组件（暂不重构）：
  Conversation / ConversationList / MessageInput / UserInfo / ChannelSetting
  GroupCard / MergeforwardMessageList
```

---

## 四、新组件开发流程

### Step 1：确认分层（30秒）

用上面的决策树判断是 Layer 1/2/3。

### Step 2：查现有组件，确认没有现成的

**如果 agent 支持 MCP（Claude Code 等本地进程 agent）：**
Storybook 跑着时，MCP server 固定在 `http://localhost:16006/mcp`。
连上后可以查询：「有没有类似 XXX 的组件？」

**如果 agent 不支持 MCP（OpenClaw ACP session 等）：**
```bash
# 列出所有现有组件
ls packages/dmworkbase/src/Components/

# 查某个组件的 props 和用法
cat packages/dmworkbase/src/Components/ComponentName/index.tsx
cat packages/dmworkbase/src/Components/ComponentName/ComponentName.stories.tsx
```

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
# 固定端口 16006（避免与常用端口冲突）
pnpm storybook
# 等价于：storybook dev -p 16006 --ci

# 地址固定为：http://localhost:16006
# MCP server：http://localhost:16006/mcp（需要 agent 支持 MCP）
```

**确认是否在跑：**
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:16006
# 200 = 正在运行  |  000 = 未启动，先跑 pnpm storybook
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

### 分支命名

```
feat/描述        功能开发
fix/描述         Bug 修复
chore/描述       工程/依赖/文档
refactor/描述    重构（不改功能）
```

Agent 开分支时，在描述里体现自己的角色或任务，例如：
```
feat/add-wkavatar-stories
fix/checkbox-class-name-migration
```

### Commit 规范

```
feat(scope): 简短描述      新功能
fix(scope): 简短描述       修复
refactor(scope): 简短描述  重构
chore(scope): 简短描述     工程变更
docs(scope): 简短描述      文档
```

### 铁律

- **禁止 push，禁止开 PR/MR**，除非 Will 明确指示
- commit 前用 `git diff --stat` 确认改动文件数，超过 10 个要警觉
- **不要提交 `yarn.lock`**，项目用 `pnpm-lock.yaml`
- 基于 `github/main` 建分支，不要基于其他分支

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
| pnpm 幽灵依赖 | 运行时 Module not found | 在 package.json 显式声明，或加到 .npmrc public-hoist-pattern |
| stories 被主项目 tsc 扫到 | TS 报错 moduleResolution | tsconfig.json exclude stories 和 .storybook |
| class component 在 StrictMode 下副作用双调用 | React 18 StrictMode 特性 | 改函数组件 + useEffect |
| 组件缺 default export | story 渲染报错「does not provide an export named default」 | index.tsx 必须同时有 default 和 named export |

---

## 十一、组件开发风格规范

### Props 设计

- 单组件 Props 不超过 **8 个**，超过考虑拆分或用 config 对象合并
- 事件 handler 统一 **on 前缀**：onConfirm / onCancel / onChange
- boolean prop 用 **is/has/can 前缀**：isLoading / hasError / canEdit
- 不传整个对象，只传组件需要的字段

```tsx
// ❌ 太多 props，职责不清
<Modal title onClose onConfirm onCancel onBack loading error data user channel />

// ✅ 合并相关 props
<Modal
  title
  state={{ loading, error }}
  onConfirm onCancel
/>
```

### 组件拆分判断

- 单文件不超过 **150 行**（含注释）→ 超过考虑拆子组件
- 有独立状态的 UI 块 → 抽成子组件
- 相同 JSX 片段出现 **3 次以上** → 抽成组件
- 有独立生命周期逻辑 → 抽成子组件

### Hooks 使用

- 超过 **3 个 useState** → 考虑抽成 `useXxx` hook
- 异步请求逻辑不写在组件里 → 抽成 service 或 hook
- `useEffect` 依赖数组超过 **4 个** → 考虑拆分逻辑

### TypeScript

- 优先用 `interface`（可扩展），`type` 用于联合类型 / 工具类型
- 禁止 `any`，用 `unknown` + 类型守卫替代
- 组件 Props 类型命名统一：`ComponentNameProps`
- 不用类型断言（`as`）绕过类型检查

---

## 十二、布局模式决策记录

> 由 UI 审查机制在 Level 3 确认后自动追加
> 格式：场景类型 + 决策 + 适用条件 + 日期

<!-- 等待第一次 Level 3 确认后填充 -->

---

## 十三、CSS 编写禁止事项

### 禁止 `!important`

用提高选择器优先级代替：

```css
/* ❌ */
.my-btn { height: 46px !important; }

/* ✅ */
.wk-login-panel .semi-button.my-btn { height: 46px; }
```

### 禁止在组件里创建新颜色变量

需要新颜色时先更新 `packages/dmworkbase/src/theme/tokens.css`，在那里定义，再通过 Token 引用。

```css
/* ❌ */
.my-component { --my-special-color: #7C5CFC; }

/* ✅ 先在 tokens.css 定义，再引用 */
.my-component { color: var(--wk-brand-primary); }
```

### 禁止直接覆盖 Semi class

```css
/* ❌ 直接改 Semi 内部 class */
.semi-button-primary { background: red; }

/* ✅ 在组件根节点覆盖 Token */
.my-component {
  --semi-color-primary: var(--wk-brand-primary);
}
```

### `@media (prefers-color-scheme: dark)` 禁止用于主题切换

项目用 `body[theme-mode=dark]` + Token 变量实现主题，不用媒体查询。
