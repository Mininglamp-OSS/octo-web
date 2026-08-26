# GS1 全局搜索消息联系人文件

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@GS1 @p1 @search @global-search`

## 目标

验证从 Chat 打开全局搜索并输入关键词后，消息、联系人和文件结果能够按 tab 展示。

## 前置条件

- fixture: `fixtures-authed`，使用已有 Chat baseline 与 mock IM。
- Per-case MSW handler: `e2e-kit/msw-handlers/gs1-global-search-results.ts`
  - 返回真实全局搜索结果结构，分别包含 message、contact、file 结果。
- handler 按请求 body 的 `keyword` gating；用例必须保持关键词断言，确保错误关键词不会返回 fixture。

## 用户操作步骤

1. 进入 Chat，打开顶部全局搜索。
2. 输入 `E2E 全局搜索`。
3. 查看消息结果。
4. 切换联系人和文件 tab。

## 预期结果

- 搜索弹窗显示关键词。
- 消息 tab 显示命中的消息。
- 联系人 tab 显示命中的联系人。
- 文件 tab 显示命中的文件。

## 反例

- 结果存在时不应显示错误态或空态。
- 切换 tab 后不应清空关键词或关闭搜索弹窗。

## 视觉基准

不建 pixel baseline；使用搜索框、tab 和结果文本断言结构。

## 摸清依据

- `packages/dmworkbase/src/Pages/Chat/index.tsx:1899-1911`: Chat 宿主挂载全局搜索并处理结果点击。
- `packages/dmworkbase/src/features/globalSearch/GlobalSearchPanel.tsx:346-455`: 搜索框、tab 和过滤器渲染。
- `packages/dmworkbase/src/bridge/globalSearch/GlobalSearchVM.ts`: 搜索状态与结果数据流。
