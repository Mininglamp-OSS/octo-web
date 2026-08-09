# S14 Summary Detail Version Restore

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@S14 @p1 @summary @detail @summary-detail @summary-version`

## 目标

验证用户在已完成的传统总结详情页可以打开「版本记录」，预览历史版本，并恢复该历史版本；恢复成功后详情正文更新为所选历史版本内容。这条 case 守护详情页版本管理的核心链路：版本按钮、右侧 panel、历史只读预览、恢复按钮、刷新当前正文。

## 前置条件

- fixture: `fixtures-authed`，本地 mock 模式已预置登录态、Space `e2e-space-001` 和中文 locale。
- Per-case MSW handler: `e2e-kit/msw-handlers/s14-summary-detail-version-restore.ts`
  - `GET */summary/api/v1/summaries` — 返回一条已完成传统总结 `S14 版本总结`。
  - `GET */summary/api/v1/summaries/14014` — 首次返回当前 V2 正文 `S14 当前版本内容`，恢复后返回 V3 正文 `S14 历史版本已恢复`。
  - `GET */summary/api/v1/summaries/14014/versions` — 返回 V2 当前版本和 V1 历史版本。
  - `GET */summary/api/v1/summaries/14014/versions/140141` — 返回 V1 详情正文 `S14 历史版本内容`。
  - `POST */summary/api/v1/summaries/14014/versions/140141/restore` — 标记恢复成功并返回 V3 result。
  - `POST */summary/api/v1/summaries/14014/read` — 详情页 mark-read 兜底。
- 不需要 mock-im-runtime seed。

## 用户操作步骤

1. 从默认 app shell 点击主导航「智能总结」。
2. 在列表页点击 `S14 版本总结` 打开详情。
3. 点击详情页头部「版本记录 2」。
4. 在右侧版本 panel 点击 V1 历史版本卡片。
5. 在中部只读预览中查看历史正文。
6. 点击 panel 底部「恢复此版本」。
7. 等待详情刷新当前正文。

## 预期结果

- 详情页初始显示标题 `S14 版本总结` 和正文 `S14 当前版本内容`。
- 头部显示「版本记录」按钮且数量为 `2`。
- 点击后右侧 panel 显示标题「版本记录」和「保留最近 3 个版本」。
- panel 中显示 `V2` 当前版本和 `V1` 历史版本。
- 点击 V1 后，中部显示「正在查看 V1 历史版本」和正文 `S14 历史版本内容`。
- 点击「恢复此版本」后出现 toast「已恢复到所选版本」。
- 刷新后的当前详情正文显示 `S14 历史版本已恢复`。

## 反例

- 如果 versions 接口只返回 1 条，详情页不应显示「版本记录」入口；本 case 会因找不到入口失败。
- 如果历史版本详情接口漏 mock，中部预览会卡在「版本详情」加载态或 sanityCheck 报 401。
- 如果 restore 后没有刷新 detail，正文仍会显示 `S14 当前版本内容`，case 应失败。

## 视觉基准

不建 pixel baseline；用版本按钮、右侧 panel 文案、历史预览和恢复后正文断言结构。

## 摸清依据

- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:633`: completed 且有 `result` 时调用 `loadVersions()`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1332`: `loadVersions()` 请求 `/summaries/:id/versions`。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2484`: `getActiveVersionContext()` 要求 versions 数量大于 1 才显示版本入口。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:1626`: `handleRestoreVersion()` 调用 `restoreSummaryVersion()` 并刷新详情。
- `packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2672`: `renderVersionPanel()` 渲染 `SummaryVersionPanel`。
- `packages/dmworksummary/src/components/SummaryVersionPanel.tsx:88`: 右侧版本 panel 渲染版本卡片和「恢复此版本」按钮。
- `packages/dmworksummary/src/api/summaryApi.ts:692`: `listSummaryVersions()` 请求 `/summaries/:id/versions`。
- `packages/dmworksummary/src/api/summaryApi.ts:699`: `restoreSummaryVersion()` 请求 `/summaries/:id/versions/:resultId/restore`。
- `packages/dmworksummary/src/api/summaryApi.ts:706`: `getSummaryVersion()` 请求 `/summaries/:id/versions/:resultId`。
- `packages/dmworksummary/src/i18n/zh-CN.json:398-400`: 版本记录 panel 文案。
- `packages/dmworksummary/src/i18n/zh-CN.json:467-468`: 恢复版本按钮和成功文案。
