# <CaseId> <Short Name>

<!-- 复制此模板起草新 case-spec:
     cp e2e/case-specs/TEMPLATE.md e2e/case-specs/C7-my-feature.md
     然后按 7 段填. 不写 spec 版本/commit hash, 修改历史用 e2e/_lib/spec-history.sh <CaseId> 查. -->

## Metadata

- Case 类型: feature flow | UI 组件契约 (harness) | 边界断言
- 目标模式: real-page seed | harness route
- 登录状态: authed fixture | anonymous | 其它
- 优先级: P0 (阻断) | P1 (回归守护) | P2 (nice-to-have)
- Tag: `@<CaseId> @<p0|p1|p2> @<module> [@<submodule>] [@<consumer>]`
  (例 `@S1 @p0 @summary @summary-create`; kit `.gitlab-ci.yml.template` 走 `--grep "@p0|@visual"` 命中门禁)

## 目标

<一段话说明这个 case 覆盖什么用户行为. 若守护某个 bug 的回归, 明写 "主线保 issue #NNN 的 fix" + 一句话说 fix 回退后现象.>

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- 需要覆盖的 baseline handler (auth guard 依赖的, 不装踢登录页): 通常 kit `_baseline/` 已装, 有额外需要在此列
- Per-case MSW handler: `e2e/msw-handlers/<CaseId>-<name>.ts`
  - `GET/POST /path/to/endpoint` — 返回什么数据 / cursor 分页规则 / 边界返回
  - 用**实际**后端 shape (从 src/ grep 出的字段名, 别猜)
- (可选) mock-im-runtime seed (`installMockImRuntime`):
  - `currentUid`, `spaceId`, `users`, `groups`, `conversations`, `messages`, `subscribers` 各填什么
- (可选) harness route 参数 (仅 harness 模式): URL query / prop / value

## 用户操作步骤

<用户视角, 含 i18n 实际渲染文本, **禁**写 selector 实现细节>

1. 打开 xxx 页面, 点开 yyy.
2. 在 zzz 输入 "关键字".
3. 等待 aaa 加载.
4. 滚到底 / 点 bbb.
5. 观察 ccc 变化.

## 预期结果

<**纯 UI 观察** (v1.22 kit 铁律). dialog 关闭 / toast 出现 / 列表新增 / 页面切换 / URL 变.
**禁**写 "发出 POST /xxx" / "postDataJSON toMatchObject". API 契约由后端契约测试保证.>

- 页面某处渲染出预期 N 条 xxx.
- 首次点击后, dialog 关闭 + toast "已 yyy" 出现.
- 滚到底后, 列表变 N+M 条.
- 到达尾部后, 尾部显示 "没有更多了".
- 全程不显示 "加载失败" / 空态.

## 反例

<应失败的场景 + 具体断言点. 反例段守护"应发生但没发生"的负向断言, 用同步 count===0 而不是 auto-wait toHaveCount(0).>

- 若 xxx 依赖回退 (源码 file:line 缺 yyy dep): 现象是 zzz 不触发, 断言 timeout.
- 若 handler 忽略 cursor 一直返首页: 第二次调用不会返新数据, 通过 message_seq 唯一确认第二页确实拼接进来.
- 若 baseline handler 缺 xxx 字段: 场景走 undefined 分支 → 沉默 401 → sanityCheck 报出 "URL 在 /login".

## 视觉基准

<默认: "不建 pixel baseline; 用 getByRole/getByText 断言结构". 只有强视觉断言 (theme / layout / illustration) 才建 baseline, 用 toHaveScreenshot() + 记录 baseline 路径.>

不建 pixel baseline; 用 `getByRole('article')` + `getByText` 断言结构.

## 摸清依据

<file:line 引用, 供后人复盘 case 逻辑. 涉及的组件 / API endpoint / 状态 store / 后端 shape 都要引一次.>

- `src/features/xxx/components/YyyPanel.tsx:60-67`: PAGE_SIZE 和 tab 定义
- `src/features/xxx/hooks/useZzz.ts:111-147`: useZzz hook (deps 必须含 enabled, fix commit 后)
- `src/features/base/api/endpoints/xxx.api.ts:341-346`: endpoint URL
- `src/features/xxx/stores/zzz.ts:42-48`: openZzz action
- 后端真实响应参考: prod xxx.example.com "关键字" 搜索, data.length=20 has_more=true, page2 data.length=17 has_more=false.
