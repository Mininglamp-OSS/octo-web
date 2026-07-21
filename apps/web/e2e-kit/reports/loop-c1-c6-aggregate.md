# C1-C6 Loop 模块 E2E Report

- Generated: 20260720
- Feature: loop-cases-c1-c6
- Kit: e2e-kit v0.3.0
- Mock 模式: MSW (Full mode)
- Runtime: node v22.22.1 · pnpm 10.32.0 · playwright 1.59.1

## Cases

| CaseId | Scenario | Status | 10x pass | Avg time |
|---|---|---|---|---|
| @C1 | 空 workspace 引导 | ✅ | 10/10 | 11.5s |
| @C2 | 创建 workspace | ✅ | 10/10 | 11.7s |
| @C3 | 有 workspace 默认视图 | ✅ | 10/10 | 11.3s |
| @C4 | 创建 issue | ✅ | 10/10 | 11.5s |
| @C5 | issue status 内联切换 | ✅ | 10/10 | 11.9s |
| @C6 | 切换 workspace | ✅ | 10/10 | 11.4s |

**总计: 60/60 pass · 11.8 min**

## Coverage vs 回路模块 flow inventory

覆盖的 flow (6 / 27 已识别):
- Workspace 生命周期: **create (C2), switch (C6), 空态引导 (C1), 有态默认视图 (C3)**  ← 4/3 flow
- Issue 生命周期: **create (C4), status 内联更新 (C5)**  ← 2/4 flow

未覆盖 (留给后续):
- Workspace: update settings
- Issue: detail 全属性 (assignee/priority/project/labels/description)
- Project / Agent / Squad / Automation / Settings / 邀请成员 / 附件 / 评论 / 时间线

## Notes / 已知限制

- 关闭真后端调用: 通过 MSW handler 兜底 + sessionStorage scenario dispatch
- 所有 case 只断 UI 状态 (v1.22 铁律), 不校验 request body / response 双重
- MSW handler 挂在 apps/web/e2e-kit/msw-handlers/loop-empty.ts, scenario 通过 sessionStorage 分发
- fixture 走 `E2E_TARGET=local` + waitForFunction __MSW_READY__
- kit 稳定性 gate (--repeat-each=10 --workers=1) 全绿, 无 flake
