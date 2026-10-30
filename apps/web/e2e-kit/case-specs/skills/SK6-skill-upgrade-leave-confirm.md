# SK6 Skill Upgrade Leave Confirmation

## Metadata

- Case 类型: feature flow
- 目标模式: real-page seed
- 登录状态: authed fixture
- 优先级: P1
- Tags: `@SK6 @p1 @skills`

## 目标

守护 `octo-marketplace#102`：有修改的 Skill 升级流程必须在当前弹窗内切换到醒目的离开确认页，并安全返回编辑。

## 前置条件

- fixture: `fixtures-authed`
- Per-case MSW handler: `e2e-kit/msw-handlers/sk6-skill-upgrade-leave-confirm.ts`
- `GET /market/api/v1/plugins` 返回当前用户拥有、已在组织内上架的 Skill。
- `GET /market/api/v1/plugin_categories` 与 `GET /market/api/v1/plugin_tags` 返回表单所需数据。

## 用户操作步骤

1. 分别以桌面和移动端尺寸打开“我的发布”中的 Skill 列表。
2. 点击“升级版本”，修改版本号和发布说明。
3. 点击“取消”，观察当前弹窗切换为离开确认页。
4. 按 Esc 返回编辑，确认输入仍被保留。
5. 再次通过右上角关闭入口进入确认页，点击“确认离开”。

## 预期结果

- 页面始终只有一个弹窗，确认态不显示或暴露原表单。
- “继续编辑”自动获得焦点；“继续编辑”和红色“确认离开”在两种尺寸下均处于视口内。
- Esc 返回编辑且保留版本号和发布说明。
- 只有点击“确认离开”才关闭升级弹窗。

## 反例

- 若恢复成嵌套弹窗，dialog 数量断言失败。
- 若 Esc 直接关闭弹窗或重建表单，保留值断言失败。
- 若移动布局把操作挤出首屏，视口断言失败。

## 视觉基准

不建 pixel baseline；测试在每种尺寸输出运行时截图，并用角色、文本、焦点和视口断言验证结构。

## 摸清依据

- `packages/dmworkskillmarket/src/pages/SkillListPage.tsx`: 已在组织上架的 Skill 进入升级流程。
- `packages/dmworkskillmarket/src/components/NewSkillModal.tsx`: 升级表单、dirty 状态和离开确认态。
- `packages/dmworkskillmarket/src/index.css`: 确认页及移动端操作布局。
