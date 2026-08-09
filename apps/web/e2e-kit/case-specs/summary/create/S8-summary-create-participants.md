# S8 Summary Create Participants

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture, mock IM runtime
- 优先级: P1
- Tags: `@S8 @p1 @summary @create @summary-create @member-select`

## 目标

验证用户创建 Summary 时能先选择聊天，再从该聊天的成员列表中选择参与者，提交后进入多人协作总结详情。这条 case 守护创建页「选择参与者」入口与 IM subscribers 接缝。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space 和中文 locale。
- mock-im-runtime seed:
  - group: `s8-project-group` / `S8 项目群`
  - users: `e2e-user-1`、`s8-member-a`、`s8-member-b`
  - subscribers: `S8 Alice`、`S8 Bob` 挂到 `s8-project-group`
- Per-case MSW handler: `s8-summary-create-participants.ts`
  - `GET */summary/api/v1/summaries` — 初始空列表。
  - `GET */summary/api/v1/summary-templates` — 创建页模板预加载兜底。
  - `GET */summary/api/v1/summary-chat-candidates` — 返回群聊候选 `S8 项目群`。
  - `POST */summary/api/v1/summaries` — 返回 `{task_id:9801}`。
  - `GET */summary/api/v1/summaries/9801` — 返回包含参与者 `S8 Alice` 的详情。
  - `POST */summary/api/v1/summaries/9801/read`、`GET */summary/api/v1/summaries/9801/versions` — 详情页后续请求兜底。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在空态点击「创建第一份总结」进入创建页。
3. 点击「选择聊天」，切到「全部群聊」，选择 `S8 项目群` 并确认。
4. 点击「选择参与者」，选择 `S8 Alice` 并确认。
5. 输入主题 `S8 多人协作总结`。
6. 点击「开始总结」。

## 预期结果

- 创建页显示已选聊天 `S8 项目群`。
- 成员选择弹窗显示 `S8 Alice`。
- 确认后创建页显示已选参与者 `S8 Alice`。
- 提交后出现 toast「总结任务已创建」。
- 详情页显示标题「S8 多人协作总结」和摘要「S8 多人协作创建完成」。

## 反例

- 未选择聊天、未输入主题时「开始总结」按钮不可用。
- 提交成功后不应显示「创建失败」或「加载失败」。

## 视觉基准

不建 pixel baseline；用实际文案和角色/文本 locator 断言成员选择与创建结果。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:763`: `handleOpenMemberSelector` 有已选聊天时传入 `Channel`。
- `packages/dmworksummary/src/components/ChatSelectorModal.tsx:111`: members 模式有 channel 时通过 IM SDK `syncSubscribes` 加载群成员。
- `packages/dmworksummary/src/components/ChatSelectorModal.tsx:581`: 右侧已选数量使用 `selectedCount` 文案。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1390`: 成员选择确认后映射为 `{user_id,name}`。
- `packages/dmworksummary/src/pages/SummaryCreatePage.tsx:604`: 提交时把 `selectedMembers` 转成 `participants`。
- `packages/dmworksummary/src/api/summaryApi.ts:290`: `createSummary()` 请求 `POST /summary/api/v1/summaries`。
- `apps/web/e2e-kit/_kit/mock-im-runtime/seed-types.ts:55`: `MockSubscriberSeed` 定义群成员 seed shape。
