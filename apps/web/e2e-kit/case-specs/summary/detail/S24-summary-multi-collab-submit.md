# S24 Summary Multi Personal Submit

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P2
- Tags: `@S24 @p2 @summary @detail @summary-detail @multi-collab`

## 目标

验证多人 BY_PERSON 总结中，当前用户的个人报告生成完成但未提交时，页面展示「提交我的总结」入口；点击提交后显示「已提交」toast，成员状态和团队汇总刷新。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s24-summary-multi-collab-submit.ts`
  - `GET */summary/api/v1/summaries` — 返回一条 BY_PERSON 多人总结 `S24 多人协作总结`。
  - `GET */summary/api/v1/summaries/24024` — 提交前返回无团队汇总，提交后返回团队汇总正文 `S24 团队汇总已刷新`。
  - `GET */summary/api/v1/summaries/24024/personal` — 提交前返回当前用户个人报告，`submitted_at=null`；提交后返回 `submitted_at`。
  - `GET */summary/api/v1/summaries/24024/members` — 提交前当前用户 completed 未提交；提交后当前用户 submitted。
  - `POST */summary/api/v1/summaries/24024/submit` — 标记提交成功。
  - `POST */summary/api/v1/summaries/24024/read`、`GET */summary/api/v1/summaries/24024/versions` — 详情页后续请求兜底。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S24 多人协作总结` 打开详情。
3. 在详情页查看当前用户的个人报告提交入口。
4. 点击「提交我的总结」。
5. 等待详情刷新。

## 预期结果

- 详情页显示 `S24 多人协作总结`。
- 提交前显示提示「你的个人总结已生成，提交后才会汇入团队总结。」。
- 提交前参与者报告区显示「我（待提交）」和 `S24 我的个人报告内容`。
- 点击提交后出现 toast「已提交」。
- 成员状态中当前用户显示「已提交」。
- 团队汇总显示 `S24 团队汇总已刷新`。

## 反例

- 如果提交入口没有渲染，用户无法把个人报告汇入团队总结，case 应因找不到「提交我的总结」失败。
- 如果 submit 接口成功后没有刷新 personal/members/detail，页面会继续显示「我（待提交）」或缺少团队汇总，case 应失败。
- 如果 submit 接口漏 mock，sanityCheck 应报 401。

## 视觉基准

不建 pixel baseline；用提交提示、成员状态和团队汇总正文断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:826`: `handleSubmitPersonal()` 调用 `submitPersonalResult()` 并刷新 personal/members/detail。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2993`: `shouldShowMySubmit()` 控制多人协作提交入口。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3006`: `renderMySubmitBar()` 渲染顶部提交提示和按钮。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3440`: `renderMyPendingSubmitRow()` 在参与者报告区渲染「我（待提交）」和提交入口。
- `packages/dmworksummary/src/api/summaryApi.ts:832`: `getPersonalResult()` 请求 `/summaries/:id/personal`。
- `packages/dmworksummary/src/api/summaryApi.ts:836`: `submitPersonalResult()` 请求 `/summaries/:id/submit`。
- `packages/dmworksummary/src/api/summaryApi.ts:840`: `getMembers()` 请求 `/summaries/:id/members`。
- `packages/dmworksummary/src/i18n/zh-CN.json:430-431`: 「提交我的总结」和提交提示文案。
