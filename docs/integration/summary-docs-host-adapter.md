# Summary 转文档 —— Web 宿主适配器

> Client summary artifact 的 host bridge/adapter 注册既有 docs 转换端口并接宿主打开能力。
> 对应 octo-client 仓库的 `docs-artifact-main-migration.md` 最后一节"总结转文档开发边界"的 Web 镜像。

## 行为清单

- 沿用总结详情页的"转为在线文档"按钮（`SummaryResultActions`），不增加第二个入口。
- Web adapter 不直接请求 Docs REST，也不导入私有 Docs 源码——通过 `WKApp.endpointManager`
  注册 `docs.convertMarkdown` 端口，由 OSS 侧 `docsPort.ts` 统一调用。新增
  `EndpointID.docsOpenDocument` 端口用于宿主侧导航。
- 仅当 Client bootstrap 声明 `capabilities.docsConversion === true`（严格布尔值）且 host
  bridge 提供了 `convertMarkdown` 和 `openDocument` 方法时才安装适配器。`1` / `"true"` 等
  非严格 true 的值不触发安装。
- 适配器不依赖 `WKApp.remoteConfig.docsOn`——`isDocsConvertAvailable()` 仍由 OSS 侧
  根据 docsOn + 端口注册状态独立管理。注册成功不等于按钮可见：UI gate 和转换调用
  仍要求服务端 appconfig `docs_on` 开启（默认 false）。
- 转换成功返回 docId 和规范链接；Client 通过 `openDocument` 在宿主侧打开。
- 失败分两种情况：全部失败（无文档残留）展示 `convertErr*` 细分文案；部分失败（文档已创建
  但导入出错）保留链接供用户打开检查，不重复创建或删除可能已写入内容的文档。
- 转文档按钮有同步重入闸，防止双击重复创建。Client 模式不预开 `about:blank`。
- `getDocsDocumentOpener()` 返回带有 scope（spaceId/uid/token）快照的函数，
  调用时如果任一身份字段已变化则拒绝（抛 `document opener scope expired` 错误）。
- 已声明能力但缺方法或可信 origin 配置错误时输出不含配置值的诊断；
  正常未启用能力时保持安静。合法 origin 的大小写、默认端口、末尾斜杠和路径会被规范化。

## 文件地图

| 文件 | 状态 | 责任 |
|---|---|---|
| `packages/dmworkbase/src/Service/Const.ts` | 修改 | 新增 `EndpointID.docsOpenDocument` |
| `packages/dmworkbase/src/bridge/docs/docsPort.ts` | 修改 | 新增 `OpenDocumentParams`、`OpenDocumentHandler`、`getDocsDocumentOpener()` |
| `packages/dmworkbase/src/bridge/docs/documentLink.ts` | 新建 | 独立可信 origin 规范化与文档链接纯校验函数 |
| `packages/dmworkbase/src/bridge/docs/docsPort.test.ts` | 新建 | 新增 `getDocsDocumentOpener` 契约测试；保留原 `src/__tests__/docsPort.test.ts` |
| `apps/web/src/client-summary/hostBridge.ts` | 修改 | bootstrap 新增可选 `capabilities`；bridge 接口新增可选 `convertMarkdown`/`openDocument` |
| `apps/web/src/client-summary/index.tsx` | 修改 | main 中安装 `installDocsAdapter(host, bootstrap)` |
| `apps/web/src/client-summary/docsAdapter.ts` | 新建 | 条件注册 `docs.convertMarkdown` + `docs.openDocument` 端点，含安全校验与 scope 捕获 |
| `apps/web/src/client-summary/docsAdapter.test.ts` | 新建 | adapter 安全校验、部分失败链接、身份过期、Origin 校验等完整契约测试 |
| `packages/dmworksummary/src/utils/convertDocError.ts` | 修改 | 新增 `create_unconfirmed` 错误码映射、`convertDocErrorDocument()` |
| `packages/dmworksummary/src/utils/convertDocError.test.ts` | 修改 | 新增 `convertDocErrorDocument` 测试 |
| `packages/dmworksummary/src/__mocks__/dmworkBase.ts` | 修改 | 新增模拟 `getDocsDocumentOpener()`（默认返回 undefined） |
| `packages/dmworksummary/src/i18n/en-US.json` | 修改 | 新增 3 条 convert 相关文案 |
| `packages/dmworksummary/src/i18n/zh-CN.json` | 修改 | 新增 3 条 convert 相关文案 |
| `packages/dmworksummary/src/pages/SummaryDetailPage.tsx` | 修改 | `handleConvertToDoc` 新增 hostOpener 路径，部分失败保留文档链接 |
| `packages/dmworksummary/src/pages/__tests__/SummaryDetailPage.convert.test.tsx` | 新建 | convert 流程单元测试 |

## 已进入上游 #1648、本 PR 不动的文件

| 文件 | 原因 |
|---|---|
| `apps/web/scripts/client-feature-build.mjs` | #1648 已添加 `OCTO_CLIENT_ARTIFACT_OUT_DIR` 和 `--outDir` 支持 |

## 安全约束

- `validateDocsDocumentLink` 要求结果 URL 等于规范化的可信 origin + `/d/:docId`，
  无 query/hash/userinfo；不接受带路径别名、转义或空白的 URL。
- `error.document` 在 resolved 与 rejected 两条路径上同样校验；Summary 展示层还会用
  请求前捕获的 `webOrigin()` 独立复核，覆盖普通 Web 的旧端口实现。
- 转换 handler 在请求发起时捕获 spaceId/uid/token，结果或异常回来时若任一字段变化则拒绝
  过期结果且不暴露链接。创建可能已完成时使用 `create_unconfirmed`，不提示直接重试。
- openDocument handler 绑定安装时的 uid/token 生命周期和可信 apiOrigin；
  身份或调用方捕获的 Space 过期时明确拒绝。错误链接也沿用原打开器，不重新捕获新身份。
- 生命周期约束：`applySession` 每个 renderer 只运行一次；账号或 token 变更必须重建 renderer，
  `sessionRevoked` 会 reload。未来加入 token 热更新时必须同时设计端口重装与旧回调失效。
- 打开失败时显示已校验 URL 的可选择文本，可在原账号和组织中手动检查；不绕过 scope
  校验自动降级到浏览器打开。
- 需要 `capabilities.docsConversion === true`（真布尔值），`1` / `"true"` 等非严格 true
  的值不触发安装。

## PR 范围

此 PR：
- 新增 Client summary artifact 的 docs 转换能力（文档打开 + 转换），共享基础端口。
- 新增 `getDocsDocumentOpener` 可选宿主打开器，Web/Client 按需注册。
- 新增 `convertDocErrorDocument` 提取部分失败保留的文档链接。
- 新增 3 条用户可见 convert 文案。
- 新建 adapter 文件及完整单元测试。

此 PR 不做：
- 不导入私有 Docs 源码或 REST 调用。
- 不改后端或普通 Web 转换实现（无注册时维持 popup 行为）。
- 不改 apps/web/ 构建脚本（#1648 已覆盖）。
- CI 增加真实、非 Mock 的 `build:client-summary` 构建及 manifest 检查。
- 不新增用户可见入口。
- 不涉及 Client 主进程集成、品质门禁文案、closePreview 等已在上游的变更。
- 不增加 clients 侧处理。

## 验证计划

```bash
# docsPort 契约测试及链接校验
pnpm --filter @octo/base exec vitest run src/bridge/docs/documentLink.test.ts src/bridge/docs/docsPort.test.ts src/__tests__/docsPort.test.ts

# Summary 错误文案映射 + 部分失败文档提取
pnpm --filter @dmwork/summary exec vitest run src/utils/convertDocError.test.ts

# SummaryDetailPage convert 流程（Web + Client 两条路径）
pnpm --filter @dmwork/summary exec vitest run src/pages/__tests__/SummaryDetailPage.convert.test.tsx

# Web adapter 完整契约测试
pnpm --filter @octo/web exec vitest run src/client-summary/docsAdapter.test.ts

# i18n 健康度检查
pnpm i18n:check
```

## 初始 PR 验证记录

基于上游 `8d066a84` 整理净增量，不再重放旧 Summary workspace 分支。
本轮基础端口测试 17 项、Web adapter/bridge 测试 29 项通过；
Summary 全量 1265 项通过，国际化检查通过。
Client 主进程已经提供转换和打开接口；发行还需从本提交构建干净的 Summary
产物、更新 Client pin，并验证跨仓转换流程。测试用的身份、HTTP 和协作服务
均应使用隔离夹具，不能把本地测试等同于生产业务验收。

Review 修复范围和验证计划见 `summary-docs-review-fixes.md`。上述数字仅对应初始 PR，
不是修复后的测试结果。
