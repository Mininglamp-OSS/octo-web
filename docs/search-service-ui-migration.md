# ChannelSearch / GlobalSearch Service + UI 迁移说明

## 当前行为清单

- 频道内搜索入口：聊天信息面板的“查找聊天内容”，在当前聊天页右侧打开唯一的 `ChannelSearchPanel`。
- 全局搜索入口：现有全局搜索框，打开唯一的 `GlobalSearchPanel`；联系人、群组沿用聚合搜索结果，聊天和文件使用新的搜索 Service。
- ChannelSearch 支持关键词、中文输入法、全部/消息/图片视频/文件 Tab、发送者/排序/时间筛选、分页、文件下载、媒体预览和定位消息。
- GlobalSearch 支持联系人/群组/聊天/文件 Tab；聊天和文件共享筛选条件与结果 mapper，结果可打开对应会话并定位消息。
- 两个入口都保留 loading、空结果、错误、长文本和分页失败状态；旧请求不能覆盖新查询，关闭或切换查询后不回写过期结果。
- 搜索接口仍受现有登录态、Space 和远端开关约束；本次不新增路由、菜单或第二套用户入口。
- 不变行为：接口 endpoint、参数语义、结果点击路由、频道消息定位、文件下载与远端开关降级行为。

## V2 参考结论

- 参考 `dmwork-org/octo-web-v2` 的搜索工作区结构和 UI/数据分离方式，不复制其组件库或样式实现。
- 当前项目按 `Service -> bridge -> features -> ui` 落地：Service 收口 HTTP 和响应兼容，bridge 管理查询状态与 mapper，feature 连接宿主能力，共享 UI 只接收 props。
- 两个搜索入口共享 Service、类型、mapper 和分页 hook，但保留各自的交互形态，避免为了复用重新耦合成一个大组件。

## 文件地图

- `packages/dmworkbase/src/Service/SearchService.ts`：ChannelSearch / GlobalSearch 的 HTTP 边界、参数和响应 envelope 兼容。
- `packages/dmworkbase/src/Service/SearchTypes.ts`：搜索查询、筛选、结果和 data source 类型。
- `packages/dmworkbase/src/Service/SearchResultMapper.ts`：后端命中结果到统一 UI model 的纯映射。
- `packages/dmworkbase/src/bridge/channelSearch/`：频道搜索 data source、筛选、分页和定位适配。
- `packages/dmworkbase/src/bridge/globalSearch/`：全局搜索 VM、data source 和筛选适配。
- `packages/dmworkbase/src/bridge/search/`：两处搜索共享的资源解析和分页状态。
- `packages/dmworkbase/src/features/channelSearch/`：频道内搜索业务容器和入口按钮。
- `packages/dmworkbase/src/features/globalSearch/`：全局搜索业务容器、feature gate 和结果定位。
- `packages/dmworkbase/src/ui/SearchWorkspace/`：两处搜索共享的纯展示工作区和 Story。
- `packages/dmworkbase/src/Components/ChannelSearch/`、`packages/dmworkbase/src/Components/GlobalSearch/`：兼容导出、结果展示组件和真实业务 Story。
- `packages/dmworkbase/src/Service/__tests__/SearchService.test.ts`、`packages/dmworkbase/src/bridge/search/__tests__/useSearchPagination.test.tsx`：Service 与分页关键路径测试。
- `packages/dmworkbase/src/i18n/locales/zh-CN.json`、`packages/dmworkbase/src/i18n/locales/en-US.json`：搜索新增文案。

## PR 范围

本 PR 包含：

- 先抽共享 Search Service / types / mapper，再迁移 ChannelSearch，最后迁移 GlobalSearch。
- 两个既有搜索入口的 Service + UI 分层、共享 SearchWorkspace、bridge、测试、Story、i18n 和 token 化样式。
- 保持一个 PR，原因是两处入口共享 mapper、类型和分页边界，拆开会产生临时双实现和重复兼容层。

本 PR 不包含：

- 后端召回、排序、分词或权限模型变更。
- 新增搜索入口、路由或消息类型。
- 与搜索无关的旧组件、全局视觉系统或其他 Service 重构。

影响范围：聊天页右侧频道搜索、全局搜索弹窗、共享搜索 Service/mapper；不改变登录、Space、路由和消息渲染契约。

## 验证计划

- 自动测试：运行 SearchService、搜索 mapper/adapter、筛选、定位、分页和 GlobalSearch 路由相关的聚焦 Vitest。
- 静态检查：`git diff --check`、`pnpm i18n:check`。
- 应用构建：`pnpm --dir apps/web build`。
- Storybook：`pnpm --dir apps/web build-storybook`，并确认 `apps/web/storybook-static/iframe.html` 和 preview assets 存在；验证后删除产物。
- Story：真实 ChannelSearch / GlobalSearch 组件覆盖默认、筛选、loading、空结果、错误和长文本；分别检查 light / dark，以及 `zh-CN` / `en-US` 的受限布局。
- 人工路径：从聊天信息面板进入频道搜索，完成搜索、筛选、切 Tab、分页、文件/媒体操作和消息定位；从全局搜索框完成联系人、群组、聊天、文件搜索和消息定位。
- 回归点：输入法 composition、防抖、请求竞态、远端开关降级、旧联系人/群组点击、文件下载和当前会话定位保持不变。
