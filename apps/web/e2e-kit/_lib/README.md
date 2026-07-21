# _lib helper 占位

本目录 PR-2 抽通用 helper.

**预计放**:
- `sanity.ts` — sanityCheck: URL 检查 / MSW 无 fallthrough / 无 retry
- `request-monitor.ts` — startRequestMonitor: 记录 case 期间所有请求, sanity 用
- `spec-history.sh` — 封装 `git log -- e2e/case-specs/<caseId>-*.md`, 替代文档里的 commit hash 回填
- `tokens.ts` — (v0.2, midscene) LLM token 消耗采集

sync 策略: **overwrite**.
