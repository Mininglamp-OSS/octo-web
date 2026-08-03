# mock-im-runtime

Playwright e2e-research 用的完整 IM mock 服务。install 之后 WKSDK 视为已连接、
所有 IM 数据（会话 / 频道 / 消息 / 成员）由 seed 派生,**不发任何真实 HTTP,
不连 WebSocket**。

## 用法

```typescript
import { installMockImRuntime } from "e2e-research/shared/mock-im-runtime";

await installMockImRuntime(page, {
  currentUid: "e2e-user-1",
  spaceId: "e2e-space-001",
  users: [
    { uid: "u-alice", name: "Alice" },
    { uid: "u-bob", name: "Bob", robot: 0 },
  ],
  groups: [{ group_no: "g-1", name: "测试群" }],
  conversations: [{ channelId: "g-1", channelType: 2, unread: 3, timestamp: 1783320000 }],
  messages: [
    {
      channelId: "g-1",
      channelType: 2,
      messageSeq: 1,
      fromUid: "u-alice",
      content: { type: 1, text: "hi" },
    },
  ],
  subscribers: [
    { uid: "u-alice", channelId: "g-1", channelType: 2 },
    { uid: "u-bob", channelId: "g-1", channelType: 2 },
  ],
});
```

Fixture (`fixtures-authed.ts`) 会在 goto '/' 之后自动装一次 **empty seed**,让 IM
立即进入 Connected 状态；case 里再调 `installMockImRuntime` 覆盖 seed 补数据。

## Seed 契约

见 `seed-types.ts`,顶层字段:

| 字段            | 类型                   | 说明                                     |
| --------------- | ---------------------- | ---------------------------------------- |
| `currentUid`    | string                 | 登录用户 uid,fake ConnectManager 用      |
| `spaceId`       | string                 | 当前 spaceId,写入 group orgData.space_id |
| `users`         | MockUserSeed[]         | 用户预热到 channelInfoCache              |
| `groups`        | MockGroupSeed[]        | 群预热到 channelInfoCache                |
| `conversations` | MockConversationSeed[] | conversationManager.sync() 返回值        |
| `messages`      | MockMessageSeed[]      | syncMessagesCallback 数据源              |
| `subscribers`   | MockSubscriberSeed[]   | syncSubscribersCallback 数据源           |

## Baseline 侵入清单

`VITE_E2E_MOCK_IM=1` 触发（dev only,prod build tree-shake）:

- `src/main.tsx`
  - 跳过 `registerImCallbacks()` (真实 provider)
  - 挂 `window.__installMockImRuntime__ = installFakeProvider`
- `src/features/base/providers/im-provider.tsx`
  - 跳过 `sdk.connect()` / `sdk.disconnect()`(否则会真去建 WebSocket)

`playwright.config.ts` TARGET=local 时设 `VITE_E2E_MOCK_IM=1`。

## Fake Provider 覆盖的 SDK Callback

| Callback                         | 数据源              | 备注                                            |
| -------------------------------- | ------------------- | ----------------------------------------------- |
| `syncConversationsCallback`      | seed.conversations  | 返 Conversation[]                               |
| `syncConversationExtrasCallback` | —                   | 返 []                                           |
| `channelInfoCallback`            | seed.groups / users | fallback (预热已覆盖大多数场景)                 |
| `syncSubscribersCallback`        | seed.subscribers    | SDK 走标准 append + notify 流程                 |
| `syncMessagesCallback`           | seed.messages       | 按 startMessageSeq / limit 分页派发 (Down 语义) |
| `syncMessageExtraCallback`       | —                   | 返 []                                           |
| `syncRemindersCallback`          | —                   | 返 []                                           |
| `reminderDoneCallback`           | —                   | no-op                                           |
| `messageReadedCallback`          | —                   | no-op                                           |

## Spy 钩子

Test 里可以断言 fake provider 收到什么调用:

- `window.__mockImSyncMessageLog__`: `Array<{ channelId, channelType,
startMessageSeq, limit, returnedSeqs }>`
  每次 `syncMessagesCallback` 调用一条,C3 分页断言用。install 时会清空。
- `window.__mockImSeed__`: 当前 seed（覆盖前最后一次 install 的）,调试用。

## 扩展指南

新 case 数据缺什么就往 seed 加。Seed 顶层字段不够就:

1. 在 `seed-types.ts` 加 field
2. 在 `fake-provider.ts` 的对应 callback 里派生
3. 别忘了更新本 README 的 Seed 契约表

如果需要模拟"IM 推送消息"（新消息实时到达）,call
`WKSDK.shared().chatManager.notifyMessageListeners(msg)` from test 侧
(fake ConnectManager 不主动 push,test 决定何时推)。

## 已迁 case

- C1 创建分组 (empty seed,只需 IM=Connected)
- C2 创建事项 (empty seed)
- C3 消息滚动分页 (50 messages seed,分页派发)
- C4 @提及自动补全 (1 group + 4 subscribers)
- C5 bot 详情二级菜单 (走 HTTP mock,IM=empty seed)
- C6 未读徽章视觉 (3 conversations + 3 groups)
- C7 全局搜索高亮 (走 HTTP mock,IM=empty seed)
- C8 UI 微改动 (empty seed,复用 C1 拓扑)

验证: 8 case × 10 run = 80/80 全绿 (v2.0 全 mock)。
