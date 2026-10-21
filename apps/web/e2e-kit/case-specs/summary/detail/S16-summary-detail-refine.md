# S16 — 继续优化后的版本保存与冲突另存

等级：P0。对应 `tests/summary/detail/S16-summary-detail-refine.spec.ts`。

## 产品规则

已完成总结不提供独立「重新生成」按钮。创建者进入「继续优化」工作台，在生成前捕获原总结 revision；预览提供「保存新版本」和「保存为新总结」。保存发生冲突时保留预览，允许另存，不能刷新 revision 后强行覆盖。

## Mock

`msw-handlers/s16-summary-detail-refine.ts` 启用 workspace contract v2，提供总结详情、optimization-target、会话历史、SSE 预览和保存接口。记录 target 请求次数、实际保存 payload 和幂等键。冲突场景仅拒绝 new_version 请求，另存返回不同 task_id。

## 场景

1. 打开已完成总结，断言旧重新生成按钮不存在，点击继续优化。
2. 输入优化要求并生成真实工作台预览；两个保存按钮都可见。
3. 保存新版本后展示原任务的新正文；请求携带生成前 revision、版本目标和可信预览标识。
4. 模拟版本冲突，断言预览与保存能力保留，再点击另存；请求不携带覆盖目标，使用不同幂等键，跳转独立任务。
5. 两条流程都断言 target 仅读取一次，且没有未 mock 的业务请求泄漏。

这些断言通过实际 UI、controller、service 和 API 序列化，不以 mock 工作台组件代替按钮行为。
