# Octo Web 国际化跟踪文档

创建日期：2026-05-27
更新日期：2026-05-28
负责分支：`feat/i18n-architecture`
关联 Issue：Mininglamp-OSS/octo-web#147

## 当前状态

- 已建立 `@octo/base` 统一 i18n runtime。
- 已支持 `zh-CN` / `en-US` 两种语言。
- 已完成根应用、登录页、NavRail、设置、Summary、Todo、Contacts、AppBot、Base Chat 高频 UI 的迁移。
- 已接入语言切换入口：
  - 登录后：NavRail 设置按钮上方。
  - 登录前：登录页右上角。
- 已接入 `pnpm i18n:scan`、`pnpm i18n:baseline`、`pnpm i18n:check`。
- 已将 `pnpm i18n:check` 接入 CI 和 PR checklist。
- 当前硬编码中文扫描：0 candidates。

## 目标

- 提供统一、可扩展、可治理的国际化架构。
- 支持 React 组件、class component、VM、module 注册、Toast、菜单注册等不同调用场景。
- 各业务包维护自己的语言包，避免巨型全局字典。
- 支持运行时切换语言，并刷新菜单、页面和 Toast 文案。
- 日期、时间、相对时间、数字、货币等格式化能力统一收口。
- 用扫描和 CI 防止新增裸中文 UI 文案。
- 为后续 agent 和维护者提供标准工作指南。

## 非目标

- 第一阶段不做 URL locale prefix，例如 `/en-US/summary`。
- 第一阶段不做服务端用户 locale preference 持久化。
- 第一阶段不做机器翻译用户内容、消息正文、总结正文、文件内容。
- 第一阶段不重构路由系统、登录流程、邀请链接流程。
- 第一阶段不新增第三种语言。

## 架构决策

### 决策 1：i18n 能力放在 `@octo/base`

业务层统一从 `@octo/base` 导入：

```ts
import { i18n, t, useI18n } from "@octo/base";
```

业务包不直接依赖第三方 i18n 引擎。底层实现可以替换，但业务调用面保持稳定。

### 决策 2：语言包归属业务包

每个拥有 UI 的 package 管理自己的 locale resources：

```txt
packages/<package>/src/i18n/
  zh-CN.json
  en-US.json
```

业务模块在 `init()` 中注册 namespace：

```ts
i18n.registerNamespace("summary", {
  "zh-CN": zhCN,
  "en-US": enUS,
});
```

### 决策 3：语义 key，不使用源语言句子做 key

推荐：

```json
{
  "summary.actions.create": "Create summary",
  "todo.toast.created": "Task created"
}
```

避免：

```json
{
  "创建总结": "Create summary"
}
```

### 决策 4：函数组件优先 `useI18n()`，非 React 场景使用 `t()`

需要响应运行时语言切换的函数组件使用 `useI18n()`：

```tsx
const { t, format } = useI18n();
```

class component、VM、Toast、module 注册和非 React helper 使用 `t()`：

```ts
Toast.success(t("base.common.saved"));
```

### 决策 5：格式化从文案中拆出去

日期、时间、相对时间、数字、货币统一走 `format`：

```ts
format.date(value);
format.time(value);
format.dateTime(value);
format.relativeTime(value);
format.number(value);
format.currency(value, "USD");
```

### 决策 6：语言切换入口随本 PR 一起落地

国际化 PR 必须包含可见语言切换入口，否则运行时切换、菜单刷新、登录前页面、Toast 和布局验收都不完整。

入口策略：

- 登录后：NavRail 常驻 icon-only 语言按钮，位置在设置按钮上方。
- 登录前：登录页右上角轻量语言按钮。
- 交互：使用 Semi `IconLanguage`，弹出 `简体中文` / `English` 菜单，当前语言用 check 标识。
- 扩展：未来超过两种语言时复用菜单结构。

### 决策 7：默认语言检测

默认语言检测顺序：

```txt
explicit locale argument
query ?locale=
localStorage octo:locale
browser first preferred language: zh* -> zh-CN, otherwise en-US
non-browser fallback: defaultLocale
```

说明：

- 用户手动切换后写入 `localStorage.octo:locale`。
- 有手动切换记录时，不再跟随浏览器语言。
- 没有手动切换记录时，中文浏览器展示中文，其他浏览器展示英文。

## 当前实现范围

### Runtime

- `packages/dmworkbase/src/i18n/I18nService.ts`
- `packages/dmworkbase/src/i18n/I18nProvider.tsx`
- `packages/dmworkbase/src/i18n/useI18n.ts`
- `packages/dmworkbase/src/i18n/detectLocale.ts`
- `packages/dmworkbase/src/i18n/format.ts`
- `packages/dmworkbase/src/i18n/locales/`

### App Shell

- `apps/web/src/i18n/`
- 根 `I18nProvider` 接入。
- `i18n.subscribe(...)` 刷新 `WKApp.config.locale`、menus 和应用监听。

### Business Namespaces

- `app`
- `base`
- `login`
- `contacts`
- `todo`
- `summary`
- `appbot`

## 执行阶段

| 阶段 | 范围 | 状态 |
| --- | --- | --- |
| C0 | 架构跟踪文档 | 已完成 |
| C1 | runtime、Provider、locale detect、语言切换入口 | 已完成 |
| C2 | 扫描、baseline、check 工具 | 已完成 |
| C3 | Summary 试点迁移 | 已完成 |
| C4 | Todo / Contacts / Login / AppBot 迁移 | 已完成 |
| C5 | Base Chat 高频 UI 迁移 | 已完成 |
| C6 | 测试、格式化、0 baseline 收口 | 已完成 |
| C7 | CI guardrail、PR checklist、浏览器视觉抽样 | 已完成 |

## 验收标准

### 自动校验

必须通过：

```bash
pnpm i18n:check
git diff --check
pnpm --filter @octo/web build
```

涉及 runtime 或语言检测时补充：

```bash
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/I18nService.test.ts
pnpm exec vitest run packages/dmworkbase/src/i18n/__tests__/detectLocale.test.ts
```

涉及业务包时运行对应 focused tests。

### 浏览器验收

文案替换后至少检查：

- `zh-CN` 和 `en-US` 都能展示。
- 文案切换后组件不需要刷新页面即可更新。
- 英文长文案不挤压按钮、侧栏、弹窗、表格和空态。
- 登录页、NavRail、设置菜单、核心业务列表、关键 modal 至少做抽样。

## 治理规则

- 新增用户可见文案必须进入 locale JSON。
- 新增 locale key 必须同时出现在 `zh-CN` 和 `en-US`。
- 插值 placeholder 必须在两个语言中保持一致。
- 非 UI 字典、协议 token、拼音/繁简转换表等例外必须写入 `.i18n/scan-config.json` 并说明原因。
- 不要为了通过扫描添加宽泛 ignore。
- 后端错误文案优先使用稳定 error code 映射；没有 code 的原始错误不应随意翻译。

## Agent 工作指南

后续涉及国际化、多语言或用户可见文案时，先读：

```txt
docs/i18n-agent-guide.md
docs/i18n-tracking.md
.i18n/scan-config.json
```

`docs/i18n-agent-guide.md` 是给 agent 的标准操作入口；本文档保留架构决策、阶段状态和治理约束。

## PR 组织方式

本次国际化采用一个大 PR，而不是多个强依赖小 PR。原因：

- runtime、language switcher、语言包、扫描 baseline、CI check 和业务替换高度耦合。
- 多 PR 会导致后续 PR 必须等待前序 PR 合并，降低效率。
- 单 PR 更适合统一做双语视觉验收。

commit 保持少量语义分段：

```txt
docs(i18n): add migration tracking plan
feat(i18n): add runtime and language switcher
feat(i18n): migrate app and product surfaces
feat(i18n): migrate base chat surfaces
test(i18n): cover localized surfaces
chore(i18n): add scanner and CI guardrails
chore(web): keep local proxy fallback resilient
```

## 后续待确认

- 是否需要服务端保存用户 locale preference。
- 服务端错误是否已有稳定 error code。
- Electron/Tauri 是否需要读取系统语言作为更高优先级。
- 是否需要在用户设置面板中补充二级语言偏好入口。
- 新增第三种语言的产品时间点。
