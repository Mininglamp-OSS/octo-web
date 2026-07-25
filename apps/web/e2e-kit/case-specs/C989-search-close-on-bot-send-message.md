# C989 顶部搜索 bot → 名片发送消息 → 外层搜索弹窗关闭

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护 — 守护 issue #989 fix 不回退)
- Tag: `@C989 @p1 @chat @chat-search @bot-detail`

## 目标

主线保 [issue #989](https://github.com/Mininglamp-OSS/octo-web/issues/989) 的 fix：**IM 顶部搜索命中 bot → 打开资料卡 → 点「发送消息」跳转会话时，外层搜索弹窗自动关闭。**

fix 回退后现象：搜索弹窗仍然停留在页面上，覆盖住会话面板，用户要手动点关闭。

## 前置条件

**Fixture**: `authed`（`apps/web/e2e-kit/fixtures-authed.ts`）
- localStorage: `octo:locale=zh-CN`、`octo:onboarding:seen=seen`、`currentSpaceId=e2e-space-001`、`{token,uid,name,app_id,short_no,role,is_work,sex,login_provider}e2etest`
- sessionStorage: `octo.session.sid=e2etest`
- URL: `?sid=e2etest`
- MSW: 已 register，chat 页 bootstrap 所有 endpoint 走 baseline handler（`chat-baseline.ts`）
- mock-im-runtime: 已 install empty seed（IM 状态视为 Connected）

**Case-specific mock**（spec 内 `worker.use(...)` 追加）:
- `POST /search/global` → 返 1 个 bot 联系人命中：`{channel_id:"e2e-bot-989", channel_type:1, channel_name:"富贵儿测试 bot", is_bot:1}`
- `GET /users/e2e-bot-989` → 返 `{uid, name, robot:1, follow:1}`（**已加好友** → BotDetailModal 显"发送消息"分支；`follow:0` 会走"添加好友"分支不适用本 case）

**Case-specific seed**（spec 内 `installMockImRuntime` 覆盖 fixture 默认）:
- users: 一个 `{uid: "e2e-bot-989", name: "富贵儿测试 bot", robot: 1}` — 让 `isBot(uid)` 返 true，TabContacts 点击命中走"打开 BotDetailModal"分支（不是 handleGlobalSearchClick 直进 DM）

## 用户操作步骤

1. 从 sidebar 点「会话」进 chat 页
2. 顶部 header 点搜索按钮（放大镜图标，无 accessible label）
3. 搜索框输入"富贵儿"
4. 联系人 tab 命中出现"富贵儿测试 bot"，点击命中项
5. BotDetailModal 打开，显示 bot 名片 + 底部「发送消息」按钮
6. 点「发送消息」按钮

## 预期结果

- 步骤 2 之后：搜索 dialog (`role=dialog` 内含"搜索联系人"placeholder) 可见
- 步骤 3-4 之后：联系人命中项"富贵儿测试 bot"可见
- 步骤 5 之后：BotDetailModal 内可见"发送消息"按钮
- **步骤 6 之后 (核心断言)**：外层搜索 dialog **消失**（`toBeHidden`），会话切换到该 bot 的 DM

## 反例

- **fix 回退**（`TabContacts.BotDetailModal.onChat` 不调 `hideModal`）→ 步骤 6 之后搜索 dialog 仍然可见 → 断言 `toBeHidden` 挂
- **`GlobalSearchPanel` 停止透传 `hideModal`**（`hideModal={undefined}`）→ 同上，`hideModal?.()` no-op
- **点错按钮**（BotDetailModal 里点「添加好友」而不是「发送消息」）→ `getByRole("button", {name:"发送消息"})` 找不到 → 前置断言就挂，不会误绿

## 视觉基准

不建 pixel baseline。断言是 DOM 可见性 + 文本，不依赖像素。

## 摸清依据

- `packages/dmworkbase/src/Components/GlobalSearch/tab-contacts.tsx:150-158` — `BotDetailModal.onChat` 里的 fix 点 `this.props.hideModal?.()`
- `packages/dmworkbase/src/features/globalSearch/GlobalSearchPanel.tsx:200-205` — `<TabContacts hideModal={this.props.hideModal} />` 透传点
- `packages/dmworkbase/src/Pages/Chat/index.tsx:1963-1978` — 外层 `<WKModal className="wk-global-search-modal">` 加 `<GlobalSearch hideModal={()=>vm.showGlobalSearch=false}>`
- `packages/dmworkbase/src/Components/GlobalSearch/tab-contacts.tsx:167-185` — `renderItem` 里 `isBot(item.channel_id)` 决定走 BotDetailModal 分支
- `packages/dmworkbase/src/Components/WKAvatar/index.tsx:13-16` — `isBot(uid)` = `channelInfoCache.get(uid).orgData.robot === 1` → 所以 mock 里要把 bot 用 seed 预热到 channelInfoCache
- `packages/dmworkbase/src/Components/BotDetailModal/index.tsx:95-101` — `handleChat` 调 `onChat(new Channel(uid, ChannelTypePerson))` + `onClose()`
- `packages/dmworkbase/src/ui/profileDetail/BotDetailView` — "发送消息"按钮由 `isFriend` 决定显示（`isFriend=true` 时 label = "发送消息"，否则 = "添加好友"），`isFriend` 来自 `BotDetailVM.state.isFriend`，源头是 `/users/:uid` 返的 `follow===1`
