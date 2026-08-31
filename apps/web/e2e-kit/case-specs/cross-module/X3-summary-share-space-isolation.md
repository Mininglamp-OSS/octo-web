# X3 Summary 分享无权访问错误态

## Metadata

- Case 类型: permission boundary
- 目标模式: standalone deep link
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@X3 @p1 @cross-module @summary @deep-link @permission`

## 目标

验证分享详情接口返回无权访问时，页面展示明确错误态，不泄露分享正文。

## 前置条件

- Per-case handler: `e2e-kit/msw-handlers/x3-summary-share-space-isolation.ts`，返回 HTTP 403 无权访问。

## 用户操作步骤

1. 直接打开复用的分享链接 `/s/share/e2e-share-026`。
2. 观察分享页状态。

## 预期结果

- 页面显示「该分享不存在、已失效或你无权查看」。
- 不显示分享标题和正文。

## 反例

- 页面显示分享正文，说明无权错误没有被正确展示，case 应失败。

## 视觉基准

不建 pixel baseline；使用错误态和正文不可见断言。

## 摸清依据

- `packages/dmworksummary/src/api/summaryApi.ts:600-609`: 分享详情请求携带当前 Space。
- `packages/dmworksummary/src/pages/SummaryShareDetailPage.tsx:48-63`: 无权访问时显示错误态。
