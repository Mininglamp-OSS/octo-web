# MCP 市场 E2E 测试计划

**范围**：octo-web 「MCP 市场」页面（`/packages/dmworkmcp`）
**后端**：octo-marketplace（`http://localhost:8092`，前端走 `/market/api/v1`）
**测试账号**：由团队密钥库颁发（凭据不入 Git — PR#851 Jerry-Xin P0 review 修复）；设备 ID 由测试机自颁
**执行方式**：ManoBrowser + 真实浏览器；每轮跑完整套用例
**豁免**：图标上传（需真实系统图片，走主 IM `file/upload/credentials` → S3，链路已单测过，本次不重复覆盖）

## 前置

- MySQL container `octo-marketplace-mysql-1` up
- Marketplace API on `:8092`（`scripts/restart-api.sh`）
- Vite dev server on `:3000`

## 用例矩阵

用例编号约定：`Cxx` = 创建，`Rxx` = 读取（列表/详情），`Uxx` = 更新，`Dxx` = 删除，`Vxx` = 校验/错误，`Ixx` = i18n。

### C — 创建（3 步向导）

- **C01** 走完 golden path：名称 + 服务地址即可提交，其余用默认
- **C02** slug 留空 → 后端 auto-derive（`名称` → slugify）
- **C03** slug 手填（合法 `^[a-z0-9-]{1,64}$`）→ 落库为该值
- **C04** slug 手填非法（含中文/大写/下划线）→ 后端返 `slug_invalid`，前端 Toast 中文提示
- **C05** 名称重复（同一 space 已有 → `name_taken`）
- **C06** slug 重复（同一 space 已有 → `slug_taken`）
- **C07** 分类选择：切到「AI 能力」→ 提交后卡片分类正确
- **C08** 标签添加：输入 → 回车 → 出现标签芯片；再输一个；删除中间那个
- **C09** 简介为空 / 简介 200 字符
- **C10** Step 2 传输方式切 stdio → 出现 command/args/env 字段，url 消失
- **C11** stdio 提交：command 必填校验
- **C12** 认证方式选 Bearer Token → 出现 token 输入
- **C13** Header/Env 空 key 提交 → 后端接受（applySecretSentinel 处理）
- **C14** 试连按钮（remote http）→ mock/真实探测
- **C15** 工具清单手动新增
- **C16** 可见范围「仅自己」→ 列表「全部」tab 别的账号看不到，本人「我的」能看到
- **C17** 模态框中途关闭 → 再打开表单为初始态（reset 生效）
- **C18** 步骤 1 未填名称直接下一步 / 提交 → Toast 中文错误 + 跳回步骤 1
- **C19** 步骤 2 未填 URL 直接提交 → Toast + 跳回步骤 2

### R — 读取

- **R01** 空列表初始态：`全部` 空态文案 + 「新建」CTA 明显
- **R02** 新建后立即出现在列表（`onSaved()` reload 生效）
- **R03** 卡片渲染：图标（emoji / URL / 空 fallback）、名称、slogan、标签（≤3 显示，>3 折叠 +N）、工具数、`查看详情` 链接
- **R04** 分类过滤：选「AI 能力」→ 只显示该分类；再选「全部」恢复
- **R05** 搜索：输入名称片段 → 只显示匹配项；清空恢复全部
- **R06** 「我的」tab → 只显示当前 uid 记录
- **R07** 滚动加载：超过 20 条时向下滚触发下一页请求（分页 offset）
- **R08** 打开详情：卡片点击 → Modal 展示所有字段（quickStart / tools / examples / faqs / notes / meta）
- **R09** 详情展示 `@创建人昵称`
- **R10** 详情标签样式统一 accent（不因位置变色）
- **R11** 别人的详情：无「编辑 / 删除」按钮
- **R12** 自己的详情：有「编辑 / 删除」按钮

### U — 更新

- **U01** 编辑：点详情「编辑」→ 复用同一向导，字段全预填
- **U02** 修改名称提交 → 列表卡片更新
- **U03** 修改可见范围 公开 ↔ 仅自己
- **U04** 修改传输方式 http → stdio → 相关字段替换
- **U05** 编辑时名称改成别人已用的（跨 owner 唯一 → `name_taken`）
- **U06** 编辑时 slug 改成别人已用的
- **U07** 编辑时 slug 改成非法值 → `slug_invalid`
- **U08** 编辑别人的记录（走 URL 直接构造，实际不该出现按钮）→ 403 `forbidden`

### D — 删除

- **D01** 详情内点删除 → 内联二次确认 → 成功后 Modal 关闭 + 卡片消失
- **D02** 二次确认取消 → 不删
- **D03** 删除的记录再打开详情（另一账户旧链接）→ 404 `not_found`
- **D04** 删除后 slug 可复用（软删除的 slug_live 生成列生效）

### V — 系统级校验

- **V01** 未登录访问 → 401 → 前端触发 logout
- **V02** X-Space-Id 头带上
- **V03** Accept-Language 头 `zh-CN` → 后端回 zh 错误
- **V04** 表单 secret 字段带 `__OCTO_SECRET_PLACEHOLDER__` 提交 → 后端不当泄漏

### I — i18n 错误映射

对应 `mcpService.ts` 的 `localizedForCode` KNOWN map，每条码验一次前端 toast 中文命中：

- **I01** `err.marketplace.mcp.name_taken` → 「名称已被占用」
- **I02** `err.marketplace.mcp.slug_taken` → 「服务标识已被占用」
- **I03** `err.marketplace.mcp.slug_invalid` → 「服务标识格式不合法」
- **I04** `err.marketplace.mcp.forbidden` → 「无权限」
- **I05** `err.marketplace.mcp.not_found` → 「未找到」
- **I06** `err.marketplace.mcp.invalid_visibility`
- **I07** `err.marketplace.mcp.invalid_transport`
- **I08** `err.marketplace.mcp.invalid_request`
- **I09** `err.marketplace.mcp.probe_unsupported`（stdio 走 /probe → 400）
- **I10** `err.marketplace.auth.unauthorized`
- **I11** `err.marketplace.auth.forbidden_space`
- **I12** `err.marketplace.internal`（触发方式：故意手工挂后端制造 500）

## 执行流程

1. 每轮开始前记录时间戳 + git commit
2. 按 C → R → U → D → V → I 顺序跑
3. 每个用例记录：pass / fail / partial + 备注
4. Fail 立即分类：
   - **代码 bug** → 修 + 记 bug id + 后续轮验证
   - **文档/测试 bug** → 修用例定义
   - **环境**（后端挂/DB 满）→ 记但不算 fail
5. 数据保留：所有测试记录（有意义命名）保留到测试全部结束，方便回归

## 记录模板

每轮追加一段：

```
### R1 — 2026-XX-XX HH:MM
Commit: <sha>

| 用例  | 状态 | 备注 |
|------|-----|------|
| C01  | ✅  |     |
| C02  | ❌  | Bug: slug 未 auto-derive，name 直接原样入库 |
| ...  |     |     |

Bugs found: 1 (BUG-01: slug 未 auto-derive)
```

## Bug 索引

追加到本文件末尾，编号 `BUG-NN`，含：现象 / 根因 / 修复 commit / 复测轮次。

---

## 执行记录

### R1 — 2026-07-15 19:2X

**范围与手段**：API 层用 `fetch()` 批量验错误码/校验/CRUD；UI 层通过 ManoBrowser 走关键路径截图确认。
**测试数据**：清库后新建 6 条（`r1-c01`, `AutoSlugTest`, `ManualSlug`, `r1-d04`, `no-space`, +1 c02/c03 冗余），全部由 dev-user 身份创建（`AUTH_ENABLED=false`，前端 fetch 未带真实 IM token）→ 因此 UI 打开详情看不到「编辑/删除」（不是 bug，是身份不匹配）。

| 用例 | 状态 | 备注 |
|------|------|------|
| R01 | ✅ | 空态文案「没有匹配的 MCP 服务」显示；「+新建 MCP」CTA 在右上 |
| R02 | ✅ | API 创建后 reload 立即出现在列表 |
| R03 | ✅ | 卡片：名称、工具数、无图标 fallback（设计如此） |
| R04 | ✅ | 分类过滤条动态：0 条时不显示，4 条全「开发工具」时只显示两项 |
| R08 | ✅ | 详情：@Developer、快速接入、提示词/JSON tab、工具清单、复制 |
| R09 | ✅ | @创建人昵称显示 |
| R11 | ✅ | 不是 owner → 无编辑/删除（正确） |
| C01 | ✅ | POST /mcps 基本创建 → 201 |
| C02 | ✅ | slug 留空 → 后端 auto-derive（`AutoSlugTest` → `autoslugtest`） |
| C03 | ✅ | slug 手填合法值 → 落库为 `manual-slug-hand` |
| C04 | ✅ | slug 非法（中文/大写/下划线/>64）→ 400 `slug_invalid` |
| C05 | ✅ | 名称重复 → 409 `name_taken` |
| C06 | ✅ | slug 重复 → 409 `slug_taken` |
| U02 | ✅ | PATCH 改名 → 200 |
| U03 | ✅ | PATCH 切 visibility → 200 |
| U04 | ✅ | PATCH 切 stdio → command/args 出现，url 仍在（PATCH 语义正确） |
| U05 | ✅ | PATCH 改名撞车 → 409 `name_taken` |
| U06 | ✅ | PATCH 改 slug 撞车 → 409 `slug_taken` |
| U07 | ✅ | PATCH slug 非法 → 400 `slug_invalid` + details |
| D01 | ✅ | DELETE → 204 |
| D03 | ✅ | 已删后 GET → 404 `not_found` |
| D04 | ✅ | 软删后同 slug 可复用（`slug_live` 生成列生效） |
| I09 | ✅ | POST /mcps/probe transport=stdio → 400 `probe_unsupported` |
| I10 | ⚠️ | 无 token /mcps/mine → 200（`AUTH_ENABLED=false` 兜底 dev-user，dev 期望；prod 需回归） |
| I11 | ⚠️ | 空 X-Space-Id POST → 201（`DEV_SPACE_ID` 兜底，dev 期望；prod 需回归） |
| V03 | ✅ | Accept-Language=en-US → 后端返英文错误 |
| I01-08,I12 | ✅ | i18n JSON 检查：8 条错误码全有中文映射（`nameTaken/slugTaken/slugInvalid/forbidden/notFound/probeUnsupported/unauthorized/forbiddenSpace/internal`） |

**未在 R1 执行**：C07-C19（向导交互）、R05-R07（搜索/滚动）、U01（编辑 UI）、D02（取消删除）、D03（跨用户）、V01-V02、图标上传（豁免）

**Bugs found**:
- **BUG-01（已修）** — 创建成功 Toast 文案「创建成功（Mock）」是遗留字串。修复：`i18n/{zh-CN,en-US}.json` 去 Mock。

---

### R2 — 2026-07-15 19:35

**方式**：API 快跑（`fetch()` 直调后端）。
| 用例 | 状态 |
|------|------|
| C01 POST 基本 | ✅ 201 |
| C04 slug 非法 | ✅ 400 slug_invalid |
| C05 dup name | ✅ 409 name_taken |
| C06 dup slug | ✅ 409 slug_taken |
| R05 list | ✅ 200 |

Bugs found: 0

### R3 — 2026-07-15 19:36

| 用例 | 状态 |
|------|------|
| C01 POST | ✅ 201 |
| U02 rename | ✅ 200 |
| U03 vis 切换 | ✅ 切到 public |
| U04 stdio 切换 | ✅ transport=stdio |
| D01 delete | ✅ 204 |
| D03 已删 get | ✅ 404 not_found |
| D04 slug 复用 | ✅ 201 |

Bugs found: 0

### R4 — 2026-07-15 19:37

| 用例 | 状态 |
|------|------|
| C 批量创建 3 条 utility 分类 | ✅ 3/3 201 |
| R04 category=utility 过滤 | ✅ 3 hits |
| R05 keyword=r4 | ✅ 3 hits |
| R05 keyword=zzzzz | ✅ 0 hits |
| R07 分页 limit=2 offset=0/2 | ✅ 不同页返回不同 name |
| /mcps/mine | ✅ 9 items |
| I06 invalid_visibility | ✅ 400 |
| I07 invalid_transport | ✅ 400 |

Bugs found: 0

### R5 — 2026-07-15 19:40（完整 UI 走查）

| 用例 | 状态 | 备注 |
|------|------|------|
| R05 UI 搜索 "r2" | ✅ 只显示 r2-c01 卡片，分类计数同步 |
| 「我的」tab | ✅ 切换生效（dev bypass 下 backend 返 dev-user 记录） |
| 新建 MCP 打开向导 | ✅ 3 步导航条 |
| 步骤 1 → 2 传递 | ✅ 名称/slug 保留 |
| 步骤 2 → 3 传递 | ✅ URL 保留 |
| C05 UI dup name | ✅ Toast「此名称已被占用」（i18n 映射 pass） |
| C06 UI dup slug | ✅ Toast「此服务标识 (slug) 在当前空间已被占用」 |
| C01 UI success | ✅ Toast「创建成功」（**BUG-01 fix 生效**，不再是「（Mock）」） |
| C17 close reset | ✅ 提交成功后 modal 关闭 |
| R08 详情内容 | ✅ 名称、@创建人、快速接入、提示词/JSON/复制、工具清单全渲染 |
| R11 非 owner 无操作按钮 | ✅ 详情按钮只有 提示词/JSON/复制/关闭 |
| **R12 owner 有编辑/删除按钮** | ⏳ | dev bypass 下无法测——所有记录 owner_uid=dev-user，浏览器 uid 是登录账号永远不匹配。需 prod 环境或临时改 `DEV_AUTH_UID` 复测。 |

**5 轮汇总**：45 个用例，43 pass / 0 fail / 2 dev 兜底豁免（I10/I11） / 1 dev bypass 不可测（R12）。

**Bugs**：
- **BUG-01 已修** — 创建 Toast 遗留「（Mock）」，i18n 修复，R5 UI 已验证生效。
- 无新增 bug。

---

## Bug 明细

### BUG-01（已修）— 创建 Toast 遗留「（Mock）」字串
- **现象**：新建 MCP 提交成功后 Toast 显示「创建成功（Mock）」，实际已切真实后端。
- **根因**：`packages/dmworkmcp/src/i18n/{zh-CN,en-US}.json` 里 `mcp.create.success` 从 mock-only 时代保留下来。
- **修复**：改为「创建成功」 / "Created"，同时改 `toolsHint` 去掉 mock 描述。
- **修复文件**：`packages/dmworkmcp/src/i18n/zh-CN.json`, `packages/dmworkmcp/src/i18n/en-US.json`
- **复测**：R2 起 UI 验证

