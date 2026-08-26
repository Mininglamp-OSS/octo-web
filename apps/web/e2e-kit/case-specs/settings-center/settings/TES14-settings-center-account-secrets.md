# TES14 Settings center account and secrets

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES14 @p1 @settings-center @account @secrets`

## 目标

验证用户可以从账户与安全页进入密钥管理，看到空状态并打开新增密钥表单。

## 前置条件

- fixture: `fixtures-authed` (E2E_TARGET=local, mock 默认装)
- Per-case handler: `GET /api/v1/manager/secrets` 返回 `{ secrets: [] }`；`GET /api/v1/users/:uid` 返回当前用户 profile。
- 不执行创建、更新或删除，避免产生持久化副作用。

## 用户操作步骤

1. 打开设置中心。
2. 打开账户与安全页。
3. 点击密钥区域的管理。
4. 点击新增密钥。

## 预期结果

- 账户页显示账号与安全、个人资料和密钥管理。
- 密钥页显示密钥空状态和添加第一个密钥。
- 新增表单显示新增密钥、名称和密钥值字段。
- 返回按钮仍可关闭密钥二级页面。

## 反例

- 若密钥列表请求失败后直接显示成功空状态，说明加载错误被错误吞掉。
- 若新增表单打开时出现旧的密钥名称或值，说明表单状态没有按打开动作清理。

## 视觉基准

不建 pixel baseline; 只断言页面、空状态、表单字段和返回入口。

## 摸清依据

- `packages/dmworkbase/src/Components/NavRail/settingsPages.tsx:76,95-98`: 账户页包含个人信息和密钥管理入口。
- `packages/dmworkbase/src/Components/NavRail/SettingsCenter.tsx:54-70,78`: 密钥二级页状态和返回入口。
- `packages/dmworkbase/src/Components/SecretsSettings/SecretsSettingsPanel.tsx:66-88,163-188,220-228`: 密钥列表加载、空状态和新增表单入口。
- `packages/dmworkbase/src/Service/SecretsService.ts:78-105`: 密钥列表 API 路径和响应契约。
- `packages/dmworkbase/src/Components/MeInfo/vm.tsx:150-165`: 账户页 profile 加载失败不阻断页面渲染。
