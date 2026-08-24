# TES20 语音快捷键页面可见性

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@TES20 @p1 @settings-center @voice @visibility`

## 目标

验证快捷键页面只在存在可用的语音快捷键时展示。

## 前置条件

- fixture: `fixtures-authed`，本地模式使用 mock IM。
- 语音设置使用用户作用域 localStorage seed。

## 用户操作步骤

1. 分别准备“语音输入关闭”和“快捷键关闭”两种状态。
2. 打开设置中心并进入“语音输入”。
3. 观察设置中心左侧导航。

## 预期结果

- 语音输入关闭时，不展示“键盘快捷键”页面入口。
- 语音输入开启但快捷键关闭时，同样不展示“键盘快捷键”页面入口。
- 语音输入和快捷键均开启时，快捷键页面可正常进入并展示右 Alt/右 Option 与 Esc。

## 反例

- 语音输入关闭后仍显示快捷键页面。
- 快捷键关闭后仍显示“右 Alt/右 Option”或快捷键页面入口。
