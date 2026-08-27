# GS4 全局搜索关键字竞态

## Metadata

- Case 类型: resilience flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@GS4 @p1 @search @global-search @race`

## 目标

验证旧关键词请求晚于新关键词返回时，页面仍只展示最新关键词的搜索结果。

## 前置条件

- fixture: `fixtures-authed`，使用 Chat mock IM。
- Per-case handler: `e2e-kit/msw-handlers/gs4-global-search-keyword-race.ts`。
  - 旧关键词 `E2E 旧关键词` 延迟返回 `GS4 旧结果`。
  - 新关键词 `E2E 新关键词` 立即返回 `GS4 新结果`。

## 用户操作步骤

1. 打开全局搜索。
2. 输入旧关键词，等待请求发出。
3. 立即改输入为新关键词。
4. 等待新关键词结果出现。

## 预期结果

- 搜索框保留新关键词。
- 页面显示 `GS4 新结果`。
- 旧请求晚返回后，`GS4 旧结果` 不覆盖新结果。

## 反例

- 页面最终显示旧结果，说明请求竞态覆盖了最新搜索结果，case 应失败。

## 视觉基准

不建 pixel baseline；使用搜索框值和结果文本断言。

## 摸清依据

- `packages/dmworkbase/src/bridge/globalSearch/GlobalSearchVM.ts:158-180`: 搜索请求使用递增 requestId 丢弃过期响应。
- `packages/dmworkbase/src/bridge/globalSearch/GlobalSearchVM.ts:137-149`: 输入变化 debounce 后触发搜索。
