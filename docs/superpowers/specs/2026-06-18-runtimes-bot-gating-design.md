# 需求 2:Web 强制「先装运行时再装 Bot」引导 — 设计文档

**日期:** 2026-06-18
**仓库:** octo-web(基线分支 `feat/agent-runtime`;web/server 仍走 runtime 分支,fleet/daemon 才切 main)
**Feature 分支(开发阶段创建):** `feat/runtimes-bot-gating`(从 `feat/agent-runtime` 拉)

---

## Goal(一句话)

在 Runtimes 页:当前 space 没有任何**在线运行时**时,「创建 Bot」入口置灰并提示「需先安装并上线运行时」,防止小白用户跳过运行时安装直接建 Bot。

## 背景 / 现状

- Runtimes 页 `RuntimesPage`(`packages/dmworkbase/src/Pages/Runtimes/index.tsx`)顶部「+」菜单有两项:「创建 Runtime」「创建 Bot」,当前**无条件可点**。
- **Bot 创建只有这一个用户入口**:菜单项(index.tsx:2046-2065)`onClick` 调 `this.botsTabRef.current?.openCreate()`。`BotsTab` 以 `hidden` 挂载(index.tsx:2006),只作创建弹窗宿主;早先的 Level-3 行内创建入口已删除(`BotsTab.tsx:30-32` 注释),因此**不存在第二个入口**。
- `RuntimesPage.state.runtimes: AgentRuntime[]` 已在内存;`AgentRuntime.status` 取值 `"online" | "offline"`。
- Bot 实际运行依赖在线运行时;现有 `CreateBotModal` 本就要求选择一个在线 runtime,无在线 runtime 时弹窗内无可选项。

## 决策(已与用户确认)

1. **UI 处理:置灰 + 提示**(不隐藏)。Bot 选项保持可见但禁用,让用户看到能力存在并理解先后顺序。
2. **Gating 条件:`≥1 个在线运行时`**(`runtimes.some(r => r.status === "online")`)。与 `CreateBotModal` 前提一致,最简洁正确。
   - *不采用* 更严的「在线且已装 octo 插件」——那与需求 1 耦合,超出本需求范围(见 Out of scope)。

## 设计

### 核心逻辑:纯函数(可单测,贴合本目录 `deviceRuntimeMode.ts` / `octoComponent.ts` 模式)

新文件 `packages/dmworkbase/src/Pages/Runtimes/botGating.ts`:

```ts
import type { AgentRuntime } from "./index"  // 若 AgentRuntime 未导出,则在 index.tsx 导出该 interface

/** 当前 space 是否存在至少一个在线运行时 —— 决定能否创建 Bot。 */
export function canCreateBot(runtimes: Pick<AgentRuntime, "status">[]): boolean {
  return runtimes.some((r) => r.status === "online")
}
```

> 注:`AgentRuntime` 目前定义在 `index.tsx`(行 17-32),需 `export` 它,或在 `botGating.ts` 里用最小结构 `{ status: string }`。优先用最小结构入参 `Pick<…,"status">`,避免循环依赖。最终落地以「不引入 index↔botGating 循环 import」为准。

### 渲染层接线(index.tsx)

`render()`(行 1996+)内,`groups` 旁计算:

```tsx
const canBot = canCreateBot(runtimes)
```

「创建 Bot」菜单项(行 2046-2065)改为:

- `disabled={!canBot}`、`aria-disabled={!canBot}`。
- `className` 在 `!canBot` 时追加置灰修饰类(如 `wk-rt-create-menu-item--disabled`)。
- `onClick`:保留原 `openCreate` 调用;`disabled` 已阻止点击(双保险:handler 内 `if (!canBot) return`)。
- 第二行描述:`!canBot` 时由 `createBotDesc` 换成提示文案 `createBotDisabledHint`(「需先安装并上线运行时」),`canBot` 时维持原 `createBotDesc`。

### 单一权威 gate(不在 BotsTab 加兜底)

gating 只落在菜单一处:禁用态(`disabled`)与点击判定(`onClick` 内 `if (!canBot) return`)都用同一份 `RuntimesPage.state.runtimes`,二者不可能不一致。

> 早先曾考虑在 `BotsTab.openCreate()` 再加一层"无在线 runtime 直接 return"的防御兜底。**已放弃**:`BotsTab` 用的是它自己异步 fetch 的另一份 runtimes,与菜单依据的父级 `state.runtimes` 是两个数据源,二者不同步(尤其 BotsTab 自身加载态)时会出现「菜单已启用但点击被静默 return」的 UX bug(codex plan review C3)。当前 bot 创建只有菜单这一个入口(`BotsTab.tsx:30-32` 注释确认行内入口已删),无需第二层。将来若新增行内创建入口,应在该入口自身渲染处用其权威数据 gate,而非跨组件用别人的数据兜底。

### 样式(index.css)

新增置灰态样式,**必须用 `--wk-*` token**(stylelint gate;见 octo-web-frontend-conventions):降低不透明度 / 改文字色为次级 token / `cursor: not-allowed`。禁止裸 hex。

### i18n(两个 locale 都加,否则踩 i18n:check gate)

`packages/dmworkbase/src/i18n/locales/zh-CN.json` 与 `en-US.json` 各新增 key(置于 `runtimes.create.createBotDesc` 后,行 1162 附近):

- `zh-CN`: `"runtimes.create.createBotDisabledHint": "需先安装并上线运行时"`
- `en-US`: `"runtimes.create.createBotDisabledHint": "Install and bring a runtime online first"`

## 状态行为表

| `runtimes` 状态 | 「创建 Bot」 |
|---|---|
| `loading`(尚未加载) | 置灰 + 提示(此时 `runtimes` 为空,`canCreateBot=false`) |
| 有 runtime 但全 `offline` | 置灰 + 提示 |
| ≥1 个 `online` | 正常可点 |

## 测试(TDD)

新文件 `packages/dmworkbase/src/Pages/Runtimes/botGating.test.ts`(vitest),覆盖三态:

1. 空数组 → `false`
2. 仅 `offline` 运行时 → `false`
3. 含 ≥1 `online`(混 offline)→ `true`

验证:`cd packages/dmworkbase && pnpm exec vitest run botGating`(dmworkbase 有自己的 vitest.config;从 apps/web 跑找不到该包测试)跑通;`pnpm lint:css` 通过(stylelint);`pnpm i18n:check` 不因本次新增 key 引入新缺失。本仓无干净的独立 typecheck gate,类型正确性靠 vitest import + vite dev server 编译目视。

渲染层 disabled 绑定的正确性由 `canCreateBot` 纯函数 + 简单接线保证,不强制新增重量级组件渲染测试(本目录现状以纯函数测为主)。

## Out of scope(明确排除)

- **需求 1**(插件一键安装)完全独立,另立 spec/plan。
- 更严的 gating(「在线且已装 octo 插件」)——与需求 1 耦合,本期不做。
- 空状态大 CTA、引导式向导等更重的 onboarding 改造(已选「置灰+提示」最小方案)。
- 不改 `CreateBotModal` / `createBot` API 链路;不动 #411 的临时 unwrap 补丁(该补丁不进本 feature 提交)。

## 风险 / 注意

- **i18n gate**:本仓 i18n:check baseline 有历史坑(见 octo-web-i18n-gate),新增 key 两 locale 必须对齐,避免引入新缺失。
- **AgentRuntime 导出**:导出 interface 或用最小结构入参,避免 index↔botGating 循环依赖。
- **不影响 #411**:本 feature 只动菜单 gating + 纯函数 + i18n + css,与 index.tsx 中 #411 的 envelope unwrap 区域不重叠。
