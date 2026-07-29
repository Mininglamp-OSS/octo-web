# TES8 profile online status

## Metadata

- Case 类型：feature e2e
- 目标模式：real page seed（chat 页 + Global Search + 资料弹窗）
- 登录状态：已登录 fixture
- 优先级：P0
- Tags：`@TES8 @p0 @chat @profile`

## 目标

覆盖 TES-8 个人 / Bot 信息弹窗在线状态的真实入口行为：用户从会话页全局搜索打开资料弹窗后，非自己的 human 可见在线/离线状态，自己资料不展示状态，Bot 详情里在线状态与业务状态 chip 并行展示。

## 前置条件

- 使用 `fixtures-authed.ts` 预置登录、中文 locale、onboarding seen、MSW ready、mock IM empty seed。
- 使用 `installMockImRuntime` 覆盖 seed：
  - 当前用户 `e2e-user-1`。
  - human online：`tes8-human-online`，`online=1`。
  - human offline：`tes8-human-offline`，`online=0`，`last_offline` 为当前时间前 2 小时。
  - Bot：`tes8-bot-online`，`robot=1`，`online=1`。
- case-specific MSW handlers：
  - `POST /search/global` 返回上述联系人搜索命中。
  - `GET /users/:uid` 返回 profile 详情字段、`follow`、`online`、`last_offline`、Bot creator 信息。
  - `GET /agent-cards/:botId/report-status` 返回 `{ code: 0, message: "ok", data: { reported: true } }`。

## 用户操作步骤

1. 打开会话页。
2. 打开顶部搜索，搜索并点击 `TES8 在线成员`。
3. 观察个人信息弹窗顶部显示 `在线`。
4. 重新进入会话页搜索并点击 `TES8 离线成员`。
5. 观察个人信息弹窗顶部显示 `离线 2 小时前`。
6. 重新进入会话页搜索并点击 `E2E Tester`（当前登录用户）。
7. 观察自己的信息弹窗顶部不出现在线/离线状态行。
8. 重新进入会话页搜索并点击 `TES8 Bot 在线`。
9. 观察 Bot 详情顶部同时显示 `在线` 与 `已上报 Agent 信息`。

## 预期结果

- 非自己的 human 在线弹窗可见绿色状态行 `在线`。
- 非自己的 human 离线弹窗可见灰色状态行 `离线 2 小时前`。
- 自己详情弹窗内没有任何 `role=status` 在线状态行。
- Bot 详情弹窗内可见 `在线`，同时可见业务 chip `已上报 Agent 信息`。
- 每个关键状态保存 keyframe 截图。

## 反例

- 自己资料虽然 mock 里带 `online=1`，但弹窗内状态行数量必须为 0。
- Bot 业务 chip 不应被在线状态替代，两者必须同时可见。

## 视觉基准

不建立 pixel baseline；本 case 只保存 keyframe 用作 evidence，不做像素回归。

## 摸清依据

- `packages/dmworkbase/src/Pages/Chat/index.tsx`：会话页顶部搜索入口与 GlobalSearch Modal。
- `packages/dmworkbase/src/Pages/Chat/vm.ts`：`handleGlobalSearchClick` 决定联系人搜索命中进入会话或资料弹窗。
- `packages/dmworkbase/src/Components/GlobalSearch/tab-contacts.tsx`：Bot 搜索命中直接打开 `BotDetailModal`。
- `packages/dmworkbase/src/Components/UserInfo/index.tsx`：个人资料弹窗接入 `ProfileOnlineStatus`，self 不传状态。
- `packages/dmworkbase/src/Components/BotDetailModal/index.tsx`：Bot 详情加载 profile 与 channelInfo。
- `packages/dmworkbase/src/ui/profileDetail/ProfileOnlineStatus.tsx`：状态文案与可访问性渲染。
