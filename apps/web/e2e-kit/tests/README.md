# Tests 占位

kit **不碰**本目录, 只在首次 sync 时建目录 + 放本 README.

## 起手写 test

```bash
cp e2e/_kit/examples/example.spec.ts e2e/tests/C7-my-feature.spec.ts
```

## Test 头部注释规范

```typescript
// @caseId C7
// @spec e2e/case-specs/C7-my-feature.md
// (不写 commit hash, 用 e2e/_lib/spec-history.sh C7 查历史)

import { test, expect } from '../fixtures-authed'
import { registerC7 } from '../msw-handlers/C7-my-feature'

test('@C7 my feature', async ({ authedPage }) => {
  await registerC7(authedPage)   // per-case handler 显式装
  // ...
})
```

## 多语言和启动请求

需要英文首屏时，在 `test.describe` 内使用 `test.use({ authedLocale: "en-US" })`。
默认语言仍为 `zh-CN`。fixture 会在首次导航前设置语言；不要为了语言再次
`authedPage.goto`，否则旧页面待处理的请求可能在 MSW client 卸载后被转发到代理。

纯 mock 成功路径可开启 `test.use({ mockApiGuard: true })`。该自动 fixture 在页面
初始化前监听 BrowserContext，并在 teardown 校验：不允许真实后端请求、Service Worker
发出的 API passthrough、API 网络错误/401/5xx，以及 Summary API 的 4xx。
正常页面导航取消和 baseline 的设备未注册 400 不属于上述错误。刻意模拟接口失败的
用例保持默认关闭；CI 的全量 proxy-error 门禁不变。

## 稳定性 gate

新 case 或改过的 case 必须 3x 全绿才能 commit (见 `global/rules.md`):

```bash
pnpm exec playwright test --grep "@C7" --repeat-each=3 --workers=1
```

sync 策略: **hands_off**.
