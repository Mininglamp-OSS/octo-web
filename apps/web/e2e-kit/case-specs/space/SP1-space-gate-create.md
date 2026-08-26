# SP1 无 Space 进入并创建 Space

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P0 (阻断)
- Tags: `@SP1 @p0 @space @space-gate`

## 目标

验证已登录但不属于任何 Space 的用户会进入 JoinSpacePage，并能通过创建 Space 进入主界面。

## 前置条件

- fixture: `fixtures-authed`，在 case 内以场景数据覆盖当前 Space 与 `/space/my` 返回为空。
- Per-case MSW handler: `e2e-kit/msw-handlers/sp1-space-gate-create.ts`
  - `GET space/my` 返回空数组。
  - 创建 Space 返回 `space_id`、`name` 等真实 Space 字段。
- 不使用真实后端写数据。

## 用户操作步骤

1. 打开已登录 Web 应用。
2. 在加入 Space 页面点击创建 Space。
3. 输入 Space 名称并确认创建。

## 预期结果

- 页面显示加入或创建 Space 的入口，而不是 Chat 主界面。
- 创建成功后，JoinSpacePage 消失并进入主界面。
- 主界面显示新 Space 名称。

## 反例

- 不应在没有 Space 时直接显示 Chat 会话区。
- 创建完成后不应停留在创建弹窗或继续显示“请先加入 Space”。

## 视觉基准

不建 pixel baseline；使用 role、label 和可见文本断言结构。

## 摸清依据

- `apps/web/src/Layout/index.tsx:324-338`: 登录后无 Space 时触发 `JoinSpacePage`。
- `apps/web/src/Components/JoinSpacePage/index.tsx:18-31`: 无 Space 页面入口与创建入口。
- `apps/web/src/Components/SpaceCreate/index.tsx:20-58`: 创建 Space 表单状态与提交入口。
