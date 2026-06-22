# cc 插件一键安装(需求 1b)设计

**状态**:设计已评审,待转 writing-plans。

## 目标

在 Runtimes 页支持对 **claude provider 运行时**一键安装 cc 适配插件(cc-channel-octo)。openclaw 的 octo 插件一键装(1a)无需密钥;cc 不同——必须由用户提供 **LLM 网关 URL + API Key**,装好后写进该运行时本机的 cc-channel-octo 配置。

跨四仓:web + fleet + octo-daemon-cli + cc-channel-octo。

## 核心安全原则

**我们不持久化存储用户的 LLM 网关 URL/key。** 只负责把它"配置到用户本机"——等价于替用户手编 cc-channel-octo 的 `config.json`,key 是用户自己的、落在用户自己机器上。

由此推出一条硬约束:

> key 在 web→fleet→daemon 的**传输途中,绝不能进入 fleet 的任何持久层**(`runtime_upgrade_task.metadata` 是明文 TEXT,且会落进 `runtime_event_log` + SSE 回放)。

满足该约束的手段是复用仓内成熟的 **bot.provision「wake-up + 独立 fetch」范式**(`octo-fleet/modules/runtime/bot_provision_fetch.go` + `octo-daemon-cli/internal/sse.go` 的 `fetchBotProvision`):SSE 唤醒只带 ID,secret 由 daemon 用独立 endpoint 单独取,fleet 只在内存里短暂中转。

## 全局约束(每个 task 实现时都适用)

- **分支基线**:fleet + octo-daemon-cli 从 `origin/main` 拉 feat 分支 → PR 合回 `main`;octo-web + octo-server + cc-channel-octo 从 `origin/feat/agent-runtime` 拉 → PR 合回 `feat/agent-runtime`。
- **OSS 无 provenance 痕迹**:代码注释 / commit / PR 禁带 AI 署名、`Co-Authored-By`、review 工具名(codex/cc/Claude)、review 轮次(round N)、finding 代号(C1/P2)。注释只留长期技术理由。
- **开发阶段标准**:不做"防止改动影响线上用户"的防御性措施,但保证代码逻辑完整性,后面上线无问题。
- **key 脱敏**:任何日志输出含 key 时按现有 `bot_token` redact 方式脱敏(`exec_openclaw.go` 范式)。

## 数据流

```
Web (Runtimes 页)
  点 cc 运行时"安装" → 弹 modal 收 {gateway_url, api_key}
  POST /fleet/api/v1/upgrades  body: {component:"cc-octo", gateway_url, api_key, ...}
        │
        ▼
Fleet
  1. createPluginUpgradeTask: 放开 component=="cc-octo" 的空 fromVersion(install)
  2. {url,key} 存入内存 transient store(按 task_id, 带 TTL ~10min)——不写 metadata
  3. 建 upgrade task(metadata 不含 secret),status=pending
  4. SSE/heartbeat 唤醒 daemon —— 只带 task_id+component,无 secret
        │
        ▼ (daemon 收到 wake-up)
Daemon
  5. 用自己的 apiKey 调 GET /v1/upgrades/{task_id}/cc-octo-config?runtime_id=N
     → 三元组 ownership gate(owner_uid+space_id+runtime_id)→ 返 {url,key}
  6. npm 安装 cc-channel-octo(若未装)+ 执行:
     cc-channel-octo configure --gateway-url <url> --api-key <key>
  7. 上报 task 完成;key 用后即弃(daemon 不持久化),日志脱敏
        │
        ▼
cc-channel-octo (用户本机)
  8. configure 命令写全局 ~/.cc-channel-octo/config.json:
     sdk.anthropicBaseUrl = url, sdk.apiKey = key (chmod 600)
  9. agent-bridge 注入 subprocess env: 有 sdk.apiKey → ANTHROPIC_API_KEY
     (镜像现有 ANTHROPIC_BASE_URL 处理)
```

## 各仓组件设计

### cc-channel-octo(补齐缺口)

现状:`config.json` 已支持 `sdk.anthropicBaseUrl`;但 API key 只从宿主 `process.env.ANTHROPIC_API_KEY` 继承,config 无字段、不持久化;且只有 `start/stop/restart/status/upgrade/version`,**无配置写入入口**。

改动:
1. **新增 `configure` 子命令**(`src/cli.ts`):`cc-channel-octo configure --gateway-url <url> --api-key <key>`。
   - 读取/创建全局 `~/.cc-channel-octo/config.json`,写入 `sdk.anthropicBaseUrl`(来自 `--gateway-url`)与新增的 `sdk.apiKey`(来自 `--api-key`)。
   - 写完对文件 `chmod 600`。
   - 两个参数都必填;缺失或空值报错退出非 0。
2. **`sdk.apiKey` 配置字段**(`src/config.ts`):config schema 增 `sdk.apiKey?: string`。
3. **env 注入**(`src/agent-bridge.ts` ~228-246 行):构建 SDK subprocess env 时,`config.sdk.apiKey` 存在则注入 `ANTHROPIC_API_KEY`,镜像现有 `ANTHROPIC_BASE_URL` 的条件注入逻辑。

### fleet

1. **放开 install guard**(`modules/runtime/upgrade.go` `createPluginUpgradeTask`):当前 `fromVersion=="" && component != componentPlugin` 一律 400;改为 `cc-octo` 也允许空 fromVersion 的 install(`componentPlugin` || `componentCcOcto`)。cc-octo install 必须带 `gateway_url` + `api_key`(缺则 400)。
2. **内存 transient store**:`map[task_id] → {url, key, expireAt}`,加锁;后台 goroutine 定期清扫过期项;TTL ~10min。**按 TTL 过期,不 fetch 即焚**(install 失败重试需重取)。
3. **独立 fetch 端点** `GET /v1/upgrades/{task_id}/cc-octo-config?runtime_id=N`:照 `bot_provision_fetch.go` 做三元组 gate(`owner_uid + space_id + runtime_id` 必须全匹配,否则 403)+ task.status in-flight 校验。命中返 `{gateway_url, api_key}`;install 缺 secret / 终态 task 返 409(daemon report failed,不静默跑无 key upgrade);普通 upgrade(无 secret)返 404(daemon 走普通 upgrade)。可重入(TTL 窗口内多次 fetch 幂等)。
4. **secret 隔离**:`{url,key}` 绝不写入 `runtime_upgrade_task.metadata`、`runtime_event_log.payload`、SSE payload。upgrade task 的 metadata 仅含非敏感标记。

### octo-daemon-cli

1. **fetch secret**(`internal/sse.go` / `plugin_upgrade.go`):收到 `component=="cc-octo"` 的 install/upgrade wake-up 且需配置时,新增 `fetchCcOctoConfig(taskID)`(照 `fetchBotProvision`),用 daemon 自身 apiKey 调 fleet 独立端点取 `{url,key}`。
2. **安装 + configure**(`internal/plugin_upgrade.go` `handlePluginUpgrade`):cc-octo 分支若插件未装先 `npm install -g @mininglamp-oss/cc-channel-octo`;然后执行 `cc-channel-octo configure --gateway-url <url> --api-key <key>`。
3. **key 生命周期**:key 仅在内存用于本次 configure,用后即弃(不写 daemon 自己的 `~/.octo-daemon/config.json`)。日志脱敏。
4. fetch 返 409(install 缺 secret / 终态)→ 标 task failed(需 web 重发);返 404(普通 upgrade)→ 走普通 upgrade 路径。

### octo-web

1. **`canInstallCcPlugin(provider, hasCcOctoPlugin)`**(`Pages/Runtimes/pluginInstall.ts`):`provider === "claude" && !hasCcOctoPlugin`。复用现有 `octoPluginInstalled` 判完成(component="cc-octo")。
2. **版本槽**:claude 运行时未装 cc-octo 时显"安装"按钮(`index.tsx` 版本槽 not-found 分支扩展,与 openclaw 并列)。
3. **安装 modal**:点 cc 运行时"安装"弹 modal,含「LLM 网关 URL」(URL 格式校验)+「API Key」(password 输入、不回显、非空校验)。提交 → POST 到 fleet install 入口(带 url+key)→ 复用 1a 的 `pollPluginUpgrade` + `octoPluginInstalled` 完成判定。
4. **i18n**:新增 key 到 `zh-CN.json` + `en-US.json`(modal 标题/字段标签/校验提示/按钮),走 `runtimes.*` flat key。

## 错误处理

- **install 重试**:fleet transient store 按 TTL 过期(非 fetch 即焚)+ 后台 sweeper 定期清,TTL 窗口内 daemon 可重复 fetch;install 命令失败 daemon 重试仍能取到 key。
- **secret 缺失/过期**:install task → fetch 返 409 → daemon 标 task failed → web 轮询显失败 → 用户重新发起安装(重填表单)。普通 upgrade task 本无 secret → 404 → daemon 走普通 upgrade。
- **ownership 不符**:fetch 端点返 403。
- **configure 参数缺失/空**:cc-channel-octo `configure` 非 0 退出,daemon 标 task failed。
- **web modal**:URL 格式非法 / key 空 → 前端拦截不提交;提交失败 / 轮询超时 → 回到可重试态。

## 测试

- **cc-channel-octo**:`configure` 写 config(含新建 + 合并已有 config)单测;`sdk.apiKey` → `ANTHROPIC_API_KEY` env 注入单测;参数缺失报错。
- **fleet**:cc-octo install guard 放开(带/不带 secret 的 400 边界);transient store TTL 过期 + 可重入 fetch;fetch 端点三元组 gate(403);**断言 secret 不出现在 metadata / event_log / SSE payload**(回归锁)。
- **daemon**:`fetchCcOctoConfig` + configure 调用链;日志脱敏;409 → failed,404 → 普通 upgrade。
- **web**:`canInstallCcPlugin` 纯函数单测(claude/openclaw/已装/未装矩阵);modal 校验单测。

## 范围(YAGNI)

- 本期只做**首次安装配置**。改 key / 轮换 / 重配走"重新安装"复用同一路径,不单独做编辑态。
- key 写**全局** `~/.cc-channel-octo/config.json`(同一用户多个 cc bot 共用一套网关+key),不做 per-bot key。
