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

## 稳定性 gate

新 case 或改过的 case 必须 10x 全绿才能 commit (见 `global/rules.md`):

```bash
pnpm exec playwright test --grep "@C7" --repeat-each=10 --workers=1
```

sync 策略: **hands_off**.
