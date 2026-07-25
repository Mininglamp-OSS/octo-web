# C1 · loop 空 workspace 引导

## 场景
新用户首次打开 /loop, 后端返回空 workspace 列表 → UI 显示空态引导 + 创建按钮.

## 前置
- Auth: e2etest sid mock (fixture 已注入 token/uid/name)
- Remote config: `dmloop_on = "1"` (mock)
- Workspaces API: `GET /fleet/api/v1/workspaces` → `[]`

## 步骤
1. goto `/loop?sid=e2etest`
2. 观察空态

## 断言
- 文本 "还没有工作区" 可见
- 文本 "创建一个工作区开始使用回路。" 可见
- 按钮 "创建工作区" 可见

## Mock
- `common/appconfig` — 强开 dmloop_on
- `fleet/api/v1/workspaces` — 空数组
- `fleet/api/v1/**` — 兜底空数组 (防漏)

## 边界 / 未覆盖
- 创建 workspace 提交流程 (留给 C2)
- workspace 有数据时的列表 + tab 切换 (留给 C3)
- 权限 / 错误码 (留给 C4)
