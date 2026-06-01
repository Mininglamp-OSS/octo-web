# octo-fleet 服务独立化（PR-A）设计

> 配套：`/Users/caster/octo/octo-daemon-cli/plan.md`（架构总图，§12 PR-A）
> 本 spec 是 PR-A 的细化。PR-B（bot_task 搬 matter）、PR-C（daemon claim loop）独立 spec。

## 目标

把 `octo-server/modules/runtime/*` 的代码、表、API、daemon 协议**完整迁移**到一个新的独立服务 `octo-fleet`（端口 :8092），使 octo-server 不再承担任何 runtime / bot 编排职责。

## 设计原则（与 plan.md §1 一致 + 修订）

1. **三个后端服务之间 0 HTTP 通信**。server / fleet / matter 不互相调对方 API
2. **统一 JWT 信任链**：server 是唯一 JWT issuer，发 `/.well-known/jwks.json`；fleet/matter 持公钥本地验签
3. **bot_token 永远不离开 server DB**：fleet 只存 bot_uid + 编排元数据（不存 token）
4. **bot_task 暂留 server**：PR-A 范围内为减小爆炸半径，bot_task 表暂时由 server 继续维护；PR-B 才搬到 matter。期间 daemon 仍走 PoC4 的 `heartbeat pending_task` 路径，由 fleet 代为返回（fleet 内部查 server？不行——见"过渡设计"）

## 过渡设计：bot_task 怎么办（PR-A 期）

PR-A 把 bot CRUD 搬走、bot_task 留 server，会引出一个尴尬：daemon 心跳到 fleet，fleet 怎么把 server 里的 bot_task 派给 daemon？这违反"三服务 0 通信"。

两条路：

- **路 1（推荐）**：**bot_task 也跟着搬到 fleet**（不到 matter，先暂存 fleet）。PR-A 完成后状态：runtime / bot / bot_task 全在 fleet。PR-B 再从 fleet 把 bot_task 搬到 matter（同事务入队改造）。
- 路 2：bot_task 留 server，daemon 心跳到 fleet 拿"managed_bots 列表"，但 task 自己直接 pull from server。这等于 daemon 跟 server/fleet 都通信——合理（你已确认），但 matter 端发起 task 时（matter 评论 @bot）matter 又得调 server 入队，会让 matter 知道 server 存在，引入 matter→server 依赖

**采用路 1**：PR-A 范围 = fleet 完整接管 runtime + bot + bot_task。PR-B 再把 bot_task 单独从 fleet 搬到 matter，daemon 改 pull 源。

## 服务边界（PR-A 完成后）

### octo-server 负责（瘦身）
- user / IM 账户 / bot 凭据（bot_token 等密码）
- space membership / auth
- **新增**：JWT issuer（`POST /v1/auth/token` 用 session/api-key 换 JWT）+ `GET /.well-known/jwks.json`
- **新增**：`GET /v1/bot/:bot_uid/token`（daemon 拉 token，daemon JWT auth，校验 `bot_uid` 的 owner == JWT.uid）
- **保留但 deprecate**：`modules/runtime/*` 的 routes 关闭（代码留底，便于 fleet 出问题 rollback）；`assets/web/js/config.js` 里 runtime 相关字段移除

### octo-fleet 负责（全新）
- runtime / bot / bot_task 三张表
- bot CRUD endpoints（与 PoC4 server 端一致）
- daemon register / heartbeat / runtime_token 颁发（其实是转发给 server 的 JWT issuer）
- bot.provision heartbeat command 派发
- bot feed reverse proxy（→ matter `GET /internal/bots/:bot_uid/feed`，**这是 matter 端 internal endpoint，PoC4 已实现**——但这里就违反"0 通信"了，见下）

### 唯一例外：fleet → matter (bot feed proxy)
PoC4 实现的 bot feed 是 fleet（当时是 server）proxy 到 matter 的 internal endpoint。这是**读路径、用户触发**，违反"0 通信"原则但能力上必要。处置：
- PR-A 期保留 proxy 模式（搬到 fleet 实现，调 matter 同样 internal endpoint）
- 长期方案：浏览器**分别**调 fleet 拿 bot 元数据 + 调 matter 拿 feed，前端拼装（同你之前提的 web 中转思路）。这是 PR-B 或后续 polish 范围

## 数据流

### 创建 bot
```
1. 浏览器 → fleet:  POST /v1/runtimes/bots {runtime_id, name}
                     ↓ fleet 落 bot 行 (status=draft)
                     ↓ fleet 返回 {id, status: draft}

2. 浏览器 → server: POST /v1/bot/mint {display_name, space_id}
                     ↓ server 创建 IM bot 账户（robot=1）
                     ↓ server 落 bot_token 在自己 DB
                     ↓ server 返回 {bot_uid}（bot_token 不返回）

3. 浏览器 → fleet:  PATCH /v1/runtimes/bots/:id {bot_uid}
                     ↓ fleet 更新行 (status=bot_minted)
                     ↓ fleet 在内部 pending_command 队列入 bot.provision

4. daemon → fleet:  heartbeat → 拿到 bot.provision pending
                     ↓ daemon 看到要 token

5. daemon → server: GET /v1/bot/:bot_uid/token  (Authorization: Bearer <daemon JWT>)
                     ↓ server 校验 JWT 有效 + bot.owner_uid == JWT.uid
                     ↓ server 返回 {bot_token}

6. daemon: 写 openclaw 配置 + bind

7. daemon → fleet:  POST /v1/daemon/bots/:id/ack {claim_token, status: success}
                     ↓ fleet 更新行 (status=active)
```

### Daemon 启动 / register
```
1. daemon → server: POST /v1/auth/token {api_key}
                     ↓ server 校验 api_key
                     ↓ server 返回 JWT (含 uid, space_id, daemon_id, exp=30天)

2. daemon → fleet:  POST /v1/daemon/register (Authorization: Bearer <JWT>)
                     ↓ fleet 用 server jwks.json 公钥本地验签
                     ↓ fleet 落 daemon 行 + 关联 runtime
                     ↓ fleet 返回 {managed_bots, heartbeat_interval}

3. daemon: 周期 heartbeat
```

### Matter 评论 @bot 派任务（PR-A 期：bot_task 在 fleet）
```
1. 浏览器 → matter: POST /matters/:id/timeline {content with @bot mention}
                     ↓ matter 解析 mention（拿到 bot_uid）
                     ↓ matter 写 timeline + activity

2. matter 怎么入 bot_task 队？
   选项 A: matter → fleet POST /v1/internal/bot_task {bot_uid, matter_id, prompt}
           ❌ 违反 0 通信
   选项 B: 浏览器 → fleet POST /v1/internal/bot_task（前端中转）
           ⚠️ 把 matter 业务逻辑（"哪些 @ 触发 dispatch"）搬到前端，前端心智负担
   选项 C: PR-A 期沿用 PoC4 现状 —— matter 不入队，server 旧 modules/runtime 仍跑入队逻辑
           ❌ 但我们说要 deprecate server runtime

→ 采用 D: matter 端先实现一个简化版的 bot_task 入队（PR-A 一并做）
         matter 同事务写 matter_bot_task（这等于把 PR-B 的"matter 同事务入队"前置到 PR-A）
         然后 PR-A 期 daemon 仍从 fleet pull（fleet 内部 proxy 一次到 matter？还是 daemon 直接 pull from matter？）

→ 这条路径的复杂度迫使我们重新考虑 PR 拆分。见"PR 拆分修订"。
```

## PR 拆分修订

原 plan §12 拆分：
- PR-A: fleet 独立 + bot CRUD + bot.provision + JWT issuer
- PR-B: matter bot_task 入队 + daemon pull from matter
- PR-C: 收尾

经上面分析，PR-A 与 bot_task 的依赖比 plan 假设的更紧。**修订为**：

- **PR-A.1**（小步）：fleet 服务起骨架 + JWT issuer（在 server）+ daemon register 走 JWT。**不动 bot CRUD / bot_task**——只把"daemon 怎么认证"切到 JWT，server runtime 模块功能不变
- **PR-A.2**：fleet 接管 bot CRUD + bot.provision + bot_task。server runtime 模块的 routes 关闭、代码留底
- **PR-B**：matter 接管 bot_task（同事务入队）+ daemon pull from matter，fleet 删 bot_task 表
- **PR-C**：server runtime 模块代码删除（确认 fleet 稳定后）

PR-A.1 + A.2 都属于"fleet 独立"主线，先 A.1 上线观察、再 A.2 切流量。

## Cutover 路径

| 阶段 | server | fleet | daemon | web | matter |
|---|---|---|---|---|---|
| 当前（PoC4） | 全持 runtime / bot / bot_task | — | 连 server | 调 server | bot feed endpoint |
| PR-A.1 后 | runtime 模块 + JWT issuer | 起骨架，只跑 daemon register | 走 JWT，daemon register 到 fleet，business 到 server | 不变 | 不变 |
| PR-A.2 后 | runtime 模块 routes 关闭 | 接管 bot / bot_task 全部业务 | 全部走 fleet | 改 vite proxy 到 fleet | 不变 |
| PR-B 后 | 同上 | bot_task 删，只剩 runtime / bot | task pull 改 matter | 不变 | bot_task 表 + 同事务入队 |
| PR-C 后 | runtime 模块代码删除 | 稳态 | 稳态 | 稳态 | 稳态 |

## 技术决策（已敲定）

| 项 | 决策 |
|---|---|
| 仓库位置 | `/Users/caster/octo/octo-fleet/`，跟 octo-* 同级，本地起步暂不建 remote |
| 仓库结构 | 独立 Go module；Makefile / cmd/fleet/main.go / internal/* |
| 技术栈 | Go 1.22+ / gin / gorm / mysql（跟 octo-server 一致，便于搬代码） |
| 端口 | :8092 |
| JWT 算法 | RS256 |
| JWT 密钥位置 | server: `~/.octo-server/jwt-priv.pem`；jwks.json 经 `/.well-known/jwks.json` 暴露 |
| JWT 内容 | `{sub: uid, space_id, daemon_id?, scope, iat, exp}` |
| JWT 浏览器有效期 | 30 分钟 + silent refresh |
| JWT daemon 有效期 | 30 天 |
| 浏览器侧 auth | 登录 `POST /v1/user/login` 直接返 JWT，session 机制退役。前端 fetch wrapper 持 JWT + refresh 逻辑 |
| daemon URL 切换 | 一次切（env `OCTO_FLEET_URL` 替代旧 server URL） |
| Web vite proxy | `/api/v1/runtimes*` → fleet :8092；`/api/v1/bot/*token` 路径仍 → server :8090 |
| daemon → server 拉 bot_token | `GET /v1/bot/:bot_uid/token`，daemon JWT auth，server 校验 `bot.owner_uid == JWT.uid` |
| server runtime 删除节奏 | PR-A.2 关闭 routes 留代码 → PR-C 真删 |
| 数据迁移 | 弃 PoC4 现有数据；fleet 起新表 |
| bot_task 归属 | PR-A.2 在 fleet（过渡） → PR-B 搬到 matter |

## 表 schema（PR-A.2 范围）

迁到 fleet 的 3 张表，schema 跟 PoC4 server 端**一致**（直接搬不改）：

- `agent_runtime`（daemon 注册的运行时实例）
- `bot`（PoC4 表，bot_uid / owner_uid / runtime_id / status / ...）
- `bot_task`（PoC4 表，过渡期间留 fleet）
- `daemon`（新表？或者用现有 `agent_runtime` 的 daemon_id 列）

需要在 implementation plan 阶段确认 schema 是否完全一致还是要 schema cleanup。

## 错误处理

- daemon JWT 过期 → daemon 401 → daemon 重新走 `POST /v1/auth/token` 用 api_key 换新 JWT
- fleet 验签失败 → 401，前端要求重登
- server 拉 token 时 `bot.owner_uid != JWT.uid` → 403
- fleet 调 matter feed proxy 失败 → 502，前端展示"feed 暂不可用"
- PR-A.2 灰度期：server runtime routes 关闭但代码留，回滚路径 = 重启 server 开启 env `LEGACY_RUNTIME_ROUTES=true` 恢复 routes

## 测试

- **PR-A.1**: 
  - server JWT issuer 单元测试
  - daemon → server 拿 JWT → daemon → fleet register 链路 e2e
  - JWT 过期 / 公钥 mismatch 拒绝路径
- **PR-A.2**:
  - bot CRUD e2e（创建 / 列表 / 归档）走 fleet
  - bot.provision e2e: 浏览器创建 → server mint → fleet 入 pending → daemon ack 链路
  - matter 评论 @bot e2e: dispatch 走 fleet 内 bot_task
  - 回滚演练：fleet 挂掉，开 `LEGACY_RUNTIME_ROUTES` 恢复 server runtime

## Open questions（写 plan 前需要进一步确认）

1. **JWT issuer 在 server 是否引入新依赖**：go-jose 还是 golang-jwt？倾向 golang-jwt（轻量、广泛）
2. **fleet 起来后 db schema 迁移工具**：用 octo-server 的 SQL 文件机制（modules/runtime/sql/*.sql）还是引入 goose / golang-migrate？倾向沿用 SQL 文件机制
3. **fleet 内部包结构**：要 mirror octo-server 的 modules/runtime/ 子目录划分（bot.go / bot_task.go / api.go），还是趁机重构？倾向不重构、先搬通
4. **bot_task 在 fleet 期的 lease/claim 逻辑**：PoC4 的 server 实现是 daemon pull 模式还是 push？PR-A.2 沿用 PoC4 逻辑即可
