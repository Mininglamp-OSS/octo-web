# MSW handlers 占位

kit **不碰**本目录（`_baseline/` 除外, 在 `templates/e2e-init/_baseline/`）, 只在首次 sync 时建目录 + 放本 README.

## Per-case handler 起手

```typescript
// e2e/msw-handlers/C7-create-category.ts
import { http, HttpResponse } from 'msw'
import type { Page } from '@playwright/test'

export async function registerC7CreateCategory(page: Page) {
  // 在 page 上追加 handler; 用 MSW browser 模式 or Playwright route.
  // PR-2 会提供 helper 让这里两模式统一 API
}
```

## 注册规范: baseline 强制 + case 按需

- **`_baseline/`** 里的 handler 由 `applyResearchRoutes(page)` 强制装 (auth guard 依赖, 不装踢登录页)
- **本目录**（`msw-handlers/<caseId>-*.ts`）由 test 自己在 spec 里显式引 + 装:
  ```typescript
  await applyResearchRoutes(authedPage)          // baseline
  await registerC7CreateCategory(authedPage)     // per-case, 显式
  ```

**禁 install-all 糖** —— 别搞一个函数把所有 case handler 全装, 会导致别的 case handler 意外拦本 case 请求, 隐性污染。

sync 策略: **hands_off**.
