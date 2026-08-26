# CH4 Chat Empty State

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1 (回归守护)
- Tags: `@CH4 @p1 @chat @empty-state`

## 目标

验证当前用户没有最近会话时，Chat 页面提供明确的空态说明和开始聊天入口。

## 前置条件

- 使用 `fixtures-authed.ts`。
- 使用默认空 mock IM seed：没有 conversations、groups 或 messages。
- 不依赖真实后端。

## 用户操作步骤

1. 打开应用并进入「会话」。
2. 观察最近会话列表区域。

## 预期结果

- 页面显示「还没有会话」。
- 页面显示「从通讯录选择联系人开始聊天」说明。
- 页面显示「找人聊天」按钮。

## 反例

- 如果空 seed 被错误渲染为加载中、异常页或空白区域，用户看不到「还没有会话」和「找人聊天」，就无法从空态开始聊天。

## 视觉基准

不建立 pixel baseline；使用用户可见文案断言。

## 摸清依据

- `packages/dmworkbase/src/Pages/Chat/index.tsx:1595-1660`：最近会话为空时的空态分支。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json:69-71`：空态标题、说明和找人聊天文案。
- `apps/web/e2e-kit/fixtures-authed.ts:94-113`：默认空 seed 的安装逻辑。
