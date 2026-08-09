# 通用规则 (v0.1)

kit 强制的**跨项目通用铁律**。接入方 e2e case 必须遵守。

## v1.22 铁律: 前端 e2e 只做 UI 观察

**规则**: e2e 断言只写"用户能观察到的 UI 状态", 不写"发出 POST /xxx" / "请求 body toMatchObject" 这类 API 双重校验。

**为什么**:
- API 契约由后端契约测试保证, e2e 重复验就是**双头维护 + 慢**
- e2e 的价值是"用户 flow 走通", 断"发了什么请求"是走了 flow 但没验 flow 效果
- API 断言 fragile: 后端字段顺序 / 加 optional field / rename 都会挂, 而 UI 未必真坏

**允许**:
- ✅ dialog 关闭
- ✅ toast 出现"已创建"
- ✅ 列表新增一项
- ✅ 页面切换 / URL 变

**禁止**:
- ❌ `page.waitForRequest(...)` + `postDataJSON toMatchObject({...})`
- ❌ 检查请求 header 特定字段
- ❌ 检查请求次数（除非验 debounce / dedup 这种 UI 侧行为）

**例外**: 反例段验"未发生某请求"是允许的（如 debounce 期间不该发请求, 用同步 `count() === 0`）。

## 稳定性铁律: 3x 才算稳

**规则**: 每个新增 / 修改的 case 必须 `--repeat-each=3` 跑 3 次全绿才算稳定, 才能 commit。

**为什么**: 单次 pass 只证明"能过", 不证明"稳定过"。3 次能覆盖基础 flake 信号，同时避免过长的本地迭代。

**执行**:
```bash
pnpm exec playwright test --grep "@C7" --repeat-each=3 --workers=1
```

## Real-page seed vs harness route 判定顺序

**默认 real-page seed** (走真业务组件 + mock IM/HTTP)。**只有**同时满足三条才用 harness route:
1. 目标是"pure UI 组件契约"（不是 feature flow）
2. 真业务里没有稳定入口能触发目标组件的所有分支
3. 组件被 ≥ 2 处业务引用（有"通用"语义）

详见 kit repo 的 [docs/methodology/case-spec-guide.md](https://codex.mlamp.cn/e2e/e2e-kit/-/blob/main/docs/methodology/case-spec-guide.md) (PR-2 落)。

## Selector 铁律

优先级: `getByRole` + name > `getByPlaceholder` > `getByText` > `getByTestId`。**禁 CSS class** selector。

同名元素消歧用 scoping: `page.locator("aside").getByRole(...)` / `dialog.getByRole(...)`, 不用 `.first()` 兜底 (fragile)。

SPA / AI 产品额外遵守:
- 禁 `waitForLoadState('networkidle')`, 改等 URL / landmark / 业务 ready 信号
- `contenteditable` 输入框用 click + keyboard, 不默认 `fill()`
- AI 流式回复用“业务完成信号 + 新实质文本兜底”两阶段等待
- 截图可见但 click timeout 时先查 overlay / `elementFromPoint` / `pointer-events`, 不用 `force: true` 掩盖

详见 kit repo 的 [docs/methodology/spa-ai-selector-strategy.md](https://codex.mlamp.cn/e2e/e2e-kit/-/blob/main/docs/methodology/spa-ai-selector-strategy.md)。


## Visual baseline 临时策略

**规则**: 不要在 fork PR 里提交本地生成的 visual baseline PNG。

**为什么**: Playwright screenshot baseline 受 CI runner 字体、抗锯齿、视口和系统环境影响；本地 PNG 不是 canonical baseline。fork PR 也通常无法让 baseline workflow 把 CI 生成的 PNG 回写到 PR 分支。

**临时方案**:
- 需要 committed snapshot 的 `@visual` case 暂时不要放进 fork PR。
- 等能使用 same-repo branch + baseline workflow 生成/回写 baseline 后，再单独补 `@visual` case。
- 如果项目已有自己的 visual baseline 回写流程，以项目流程为准。

## Flake 排查顺序

**禁**一上来加 timeout。顺序:
1. 看 `test-results/<case>/error-context.md` 里的 Error details
2. 看 Page snapshot 里 DOM 实际状态
3. 才回去改 test

大部分 flake 是 selector 不精确 / DOM 未 mount / race condition, 不是 timeout 短。
