# 跨 Space 未读数字实施计划

## 目标

在 Web 组织入口和 Space 切换弹窗展示非当前 Space 的未读数字，复用现有会话未读与已读机制，不另建未读系统。

## 行为清单

1. 非当前 Space 的会话收到未读消息，且客户端可确认其未静音时，同时增加该 Space 的全部未读与新增未读；组织入口显示所有非当前 Space 新增未读之和。
2. 打开弹窗不清除新增标识；有新增的 Space 显示红底白字新增数，其余 Space 显示灰色全部未读。
3. 弹窗由打开变为关闭时清除新增标识，但保留全部未读；再次打开时显示灰色全部未读。
4. 当前 Space 只显示选中勾；进入 Space 后由现有同步和已读流程校准真实未读，不因切换动作直接清零。
5. 静音会话（子区按父群有效静音）不参与两类数字；数字仅在显示层封顶为 `99+`。

## 文件地图

### octo-server

- `modules/message/api_conversation.go`：为 `/conversation/sync` 增加可选请求参数和 `space_unreads` 响应；在当前 Space 过滤之前聚合。
- `modules/message/space_unread.go`：复用单聊未读消息窗口，一次遍历生成各 Space 未读，避免新增第三次 IM 查询。
- `modules/message/*_test.go`：覆盖群聊、单聊、子区、外部群、静音、空快照和失败省略。

### octo-web

- `packages/dmworkdatasource/src/im-callbacks/conversations.ts`：请求可选快照并暂存未读与群归属 sideband，不提前提交状态，也不写入既有 SpaceFilter 全局映射。
- `packages/dmworkbase/src/im-runtime/currentConversationSync.ts`：把暂存快照带到 guarded commit。
- `packages/dmworkbase/src/features/space-unread/`：维护 `totalBySpace`、`newBySpace`、功能专用群归属映射、实时修订号和有界消息 ID 去重。
- `packages/dmworkbase/src/module.tsx`：在现有消息监听中旁路更新数字，不修改通知决策。
- `packages/dmworkbase/src/Components/NavRail/NavSpaceSwitcher.tsx`、`packages/dmworkbase/src/Components/SpaceItem/`：渲染入口红色角标和 Space 行红/灰数字。

## 数据与资源约束

- 复用 `/conversation/sync`，不新增接口、表、Redis、轮询或常驻服务端缓存。
- `include_space_unreads=true` 且同步结果可视为完整快照时才返回字段；字段缺失时 Web 保留旧值。
- 聚合是一次 O(会话数 + 单聊未读消息数) 遍历，请求级内存为 O(Space 数)。
- 单聊只复用当前未读消息读取；不得增加第三次 WuKongIM 查询。
- Web 只保存在内存中，刷新、重新登录或换设备无需保留“新增未读”。
- 组织角标的群归属映射按服务端 `space_memberships` 整体替换，不修改会话列表、转发和通知共用的 SpaceFilter Map。

## PR 范围

### 包含

- 服务端可选 Space 未读快照。
- Web 全部未读/新增未读内存状态、实时更新、竞态保护和 UI。
- 单元测试、组件 Story、浅色/深色样式验证。

### 不包含

- 桌面通知、提示音、通知点击行为。
- 移动端或跨设备数字同步。
- 会话列表的 Space 过滤规则和既有已读协议改造。
- 本地持久化、后台轮询及新的缓存设施。

### 明确降级边界

- 实时消息缺少静音元数据时不增加红色新增数，也不在消息热路径发起查询；后续 `/conversation/sync` 权威快照校准灰色总数。
- 未携带 `space_id` 的旧版单聊消息不猜测跨 Space 归属；后续权威快照校准总数。
- 灰色总数依赖 octo-server#904 的可选 `space_unreads` sideband；旧服务端不返回该字段时，灰色数字只能反映本次 Web 会话内观察到的累计值，其他端已读后可能不会下降。
- 群归属优先使用完整的 `space_memberships` 快照；字段缺失时，外部群复用现有会话同步写入的 `my_source_space_id` 映射，再回退到群自身的 `space_id`，不新增查询。
- 子区沿用父群有效静音口径，不新增独立服务端静音查询。
- 不写入共享 SpaceFilter Map，不修改桌面通知、提示音、通知点击或会话过滤逻辑。

## 验证计划

1. Server：聚合纯函数与响应序列化测试；确认静音排除、外部群 effective Space、子区父群归属、单聊分桶和不完整时省略字段。
2. Datasource：确认请求参数、字段缺失/空对象的区分以及过期请求不提交。
3. Store：确认权威替换、实时消息去重、旧快照不覆盖实时增量、`new <= total`、关闭清除。
4. UI：确认当前勾、红色新增、灰色总数、无数字和 `99+`；Story 覆盖浅色/深色。
5. 回归：当前 Space 会话列表不混入其他 Space；通知相关文件行为不变。

## 实施顺序

1. 服务端响应契约与聚合。
2. Web 数据源和 guarded commit。
3. Web 实时状态与 UI。
4. 定向测试、类型检查和 diff 规则复核。

## 部署顺序

1. 先部署 octo-server#904，使 `/conversation/sync` 能返回权威的 `space_unreads` 快照。
2. 再部署 octo-web#1727，启用组织入口和 Space 行未读数字。

此顺序是生产发布依赖，不是 Web PR 的合并阻塞项。Web 保持对旧服务端兼容：sideband 缺失时不会使会话同步失败，只是不具备灰色总数的服务端校准能力。

## 验证记录

- Server 聚合定向测试与 `go vet ./modules/message/...` 通过；已覆盖 WuKongIM `PullModeDown` 未读窗口方向，防止 Recents 不足时漏计跨 Space 私聊。
- Datasource 全量测试：13 个文件、101 个用例通过；其中定向测试为 2 个文件、15 个用例。
- Base 全量测试：543 个文件、5635 个用例通过；其中定向测试为 5 个文件、35 个用例。覆盖实时更新、外部群 source Space 回退、去重、账号切换重置、同步与实时消息竞态、Space 前缀归属、静音元数据缺失、关闭弹窗清除和 `99+`。
- Web 生产构建和 `pnpm i18n:check` 通过；灰色角标文字对比度为浅色 5.91:1、暗色 10.84:1。
- Docker E2E 通过：单用户四组织、130 条混合压测（非当前 Space 120 条）、静音群、静音私聊、活跃子区、父群静音子区和跨 Space 私聊；实时红标、关闭后灰标、`99+` 与刷新后服务端快照均一致。
- E2E 中创建的四个组织、群、子区和消息全部保留，未执行数据清理。
- Stylelint：本次新增样式 0 error；输出仅包含原文件已有 warning。
- Storybook：Space 行红色、灰色、`99+` 及浅色/深色渲染通过；NavRail 整体 Story 受仓库缺少 `@octo/chat-core`、`@octo/chat-react` 等工作区依赖阻塞。
- 全量 TypeScript 检查受当前工作区错误依赖到 `octo-docs-module` 的 React 17 类型及既有类型错误阻塞；定向 Vitest 编译和运行通过。
