# Card Forge Render Profile 本地联调说明

## Behavior List

- Entry：不新增生产菜单或路由；通过 Interactive Card Story 和本地 Mock 消息验证。
- Legacy path：消息缺少 `render_profile` 时，继续使用现有 HostConfig、`wk-interactive-card-sdk` 根类与线上 CSS。
- Forge path：消息显式携带 `render_profile: "octo-chat/v1"` 时，使用 Forge 制品内 HostConfig、主题与作用域 CSS。
- Unsupported path：未知的非空 `render_profile` 不套用 legacy 样式，回退现有客户端升级提示。
- Interaction：OpenUrl、ToggleVisibility、Submit 的既有安全与权限逻辑保持不变。
- Error state：卡片结构、Wire Profile 或 Render Profile 不受支持时继续整卡回退 plain/hint。

## File Map

- `packages/dmworkbase/package.json`：固定安装 npm 发布的 Forge `1.2.0-rc.1` 制品。
- `Messages/InteractiveCard/InteractiveCardContent.ts`：容忍解析/编码可选 `render_profile`。
- `Messages/InteractiveCard/renderDecision.ts`：在原 Wire Profile 协商之外选择 legacy/Forge 渲染档位。
- `Messages/InteractiveCard/sdk/renderOctoCard.ts`：按档位选择现有 HostConfig 或制品 HostConfig。
- `Messages/InteractiveCard/InteractiveCardCell.tsx`：legacy/Forge 根类互斥。
- `Messages/InteractiveCard/index.css`：仅保留 Forge 宿主布局壳；业务视觉来自制品 CSS。
- `Messages/InteractiveCard/*.stories.tsx`：320/480/640 下展示新旧卡及两张 Forge 卡。
- `Messages/InteractiveCard/__tests__/*`：锁定缺字段兼容、未知档位和根类/HostConfig 选择。

## PR Scope

This PR does:

- 接入单一 `octo-chat/v1` Render Profile 兼容代际。
- 保持历史消息默认走 legacy。
- 提供本地可复现的 Forge/legacy 并排验证入口。

This PR does not do:

- 不修改后端消息模板或启用生产 `render_profile`。
- 不处理明暗双主题。
- 不发布 npm 正式版本，不调整 Card Action 服务端语义。

Impact：共享消息渲染层，仅影响 type-17 Interactive Card；其他消息类型不变。

## Verification Plan

- 自动化：运行 InteractiveCard 定向 Vitest、`pnpm --filter @octo/base test` 和类型检查。
- Story：在 320/480/640 查看 legacy、行动决策 0.2、文档申请 0.3。
- 手工：确认 legacy DOM 根类与 Forge 根类互斥；确认按钮、Header、Footer、分割线一致。
- 回归：缺 `render_profile` 的现有线上卡片 DOM、HostConfig 与交互保持不变。
