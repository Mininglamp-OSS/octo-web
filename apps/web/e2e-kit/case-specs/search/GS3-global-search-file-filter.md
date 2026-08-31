# GS3 全局搜索文件类型筛选与清空

## Metadata

- Case 类型: interaction flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@GS3 @p1 @search @global-search @filter`

## 目标

验证全局搜索文件结果可以打开文件类型筛选，应用筛选后保持结果，并可清空筛选恢复默认状态。

## 前置条件

- fixture: `fixtures-authed`，使用已有 Chat mock IM。
- Per-case handler: `e2e-kit/msw-handlers/gs3-global-search-file-filter.ts`。

## 用户操作步骤

1. 从 Chat 打开全局搜索并输入 `E2E 文件筛选`。
2. 切换到「文件」结果。
3. 打开「筛选」，选择「文档」文件类型。
4. 清空筛选。

## 预期结果

- 文件结果显示「GS3 文件.pdf」。
- 选择「文档」后筛选按钮显示已选数量。
- 清空筛选后已选数量消失，文件结果仍可见。

## 反例

- 文件类型选项加载失败时，不能完成筛选操作，case 应失败。
- 清空筛选后仍保留已选数量，case 应失败。

## 视觉基准

不建 pixel baseline；使用文件结果、筛选按钮和 aria 状态断言。

## 摸清依据

- `packages/dmworkbase/src/features/globalSearch/GlobalSearchPanel.tsx:359-447`: 筛选入口、计数和清空行为。
- `packages/dmworkbase/src/Components/GlobalSearch/GlobalSearchFilterPanel.tsx:784-824`: 文件类型选项和选中状态。
- `packages/dmworkbase/src/Service/SearchService.ts:518-535`: 文件类型接口响应结构。
