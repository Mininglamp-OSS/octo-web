# GS2 全局搜索失败后重新搜索

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@GS2 @p1 @search @global-search @error-state`

## 目标

验证全局搜索接口失败时向用户展示明确错误提示，用户修改关键词重新搜索后能够恢复结果，且搜索弹窗和关键词输入仍然可用。

## 前置条件

- fixture: `fixtures-authed`，使用已有 Chat baseline 与 mock IM。
- Per-case MSW handler: `e2e-kit/msw-handlers/gs2-global-search-failure-retry.ts`
  - 空关键词初始化返回空结果。
  - 首次搜索 `E2E 搜索失败` 返回 HTTP 503。
  - 用户重新搜索 `E2E 搜索恢复` 返回联系人结果 `GS2 恢复联系人`。

## 用户操作步骤

1. 进入 Chat，打开顶部全局搜索。
2. 输入 `E2E 搜索失败`。
3. 观察搜索失败提示。
4. 清空关键词并输入 `E2E 搜索恢复`。
5. 查看恢复后的联系人结果。

## 预期结果

- 搜索失败时显示「搜索失败，请稍后重试」。
- 搜索弹窗和输入框仍然可见，用户可以继续编辑关键词。
- 重新搜索后显示联系人「GS2 恢复联系人」。
- 恢复成功后不再显示搜索失败提示。

## 反例

- 搜索失败被当作空结果时，用户无法看到「搜索失败，请稍后重试」，case 应失败。
- 失败后若搜索输入不可用或弹窗关闭，无法完成重新搜索，case 应失败。
- 重新搜索后仍停留在错误态或空态，恢复联系人不会出现，case 应失败。

## 视觉基准

不建 pixel baseline；使用 `getByRole` + `getByText` 断言错误提示、输入框和结果结构。

## 摸清依据

- `packages/dmworkbase/src/bridge/globalSearch/GlobalSearchVM.ts:137-145`: 输入变化 debounce 后重置搜索并发起新请求。
- `packages/dmworkbase/src/bridge/globalSearch/GlobalSearchVM.ts:250-279`: 搜索异常设置用户可见的 `searchError`，成功请求清理并更新结果。
- `packages/dmworkbase/src/features/globalSearch/GlobalSearchPanel.tsx:348-357`: 全局搜索将 `searchError` 传入搜索工作区。
- `packages/dmworkbase/src/ui/SearchWorkspace/index.tsx:54-58`: 搜索错误以 `role=alert` 展示。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:1021`: 搜索失败提示实际文案。
