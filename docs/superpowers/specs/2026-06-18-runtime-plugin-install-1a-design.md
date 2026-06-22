# 需求 1a:openclaw 插件一键安装 + 版本槽状态机 — 设计文档

**日期:** 2026-06-18
**范围:** 需求 1 拆分后的第一子需求(1a)。1b(cc 插件 + LLM 网关/key 安全流转 + cc-channel-octo 改代码)另立 spec。
**涉及仓库 / 分支基线:**
- octo-web → `feat/agent-runtime`
- octo-fleet → `main`
- octo-daemon-cli → `main`(预计改动很小)

> 三仓基线不同 → **3 个独立 PR**,有合并顺序依赖(见下「交付顺序」)。

---

## Goal(一句话)

Runtimes 页:openclaw 运行时的 octo 适配插件**未安装**时,版本号位置显示「安装」按钮,点击经 fleet→daemon 一键执行 `create-openclaw-octo install`,装好后回到正常的版本号展示(有更新仍显示「升级」)。

## 背景 / 现状

- 插件版本展示在 `octo-web` 的 Runtimes detail(`index.tsx` ~1361-1395):从 runtime 的 plugins 列表里按 `octoComponentName(provider)` 找插件(openclaw→`octo`),找到则显示版本号 + (有更新时)「升级」按钮(`handlePluginUpgrade` → `POST /v1/upgrades` + 轮询)。**插件未找到时目前只有安装指引 popover(手动复制命令)。**
- `octo-fleet`(main,含 #40):`POST /v1/upgrades`(`upgradeInit`)创建 `runtime_upgrade_task`。**当前对"插件不在 runtime.plugins 里"返 400、`from_version` 为空也返错** —— 即只支持升级已存在插件,不支持装未装的。
- `octo-daemon-cli`(main):`handlePluginUpgrade("octo")` 实际执行 `npx -y create-openclaw-octo install`(该命令对首装与升级都适用,幂等),随后探测 gateway + enrichDetectAndRegister 重注册,服务端 register 时关单。

## 决策(已与用户确认)

1. **UI = 版本槽状态机**(仅作用于 openclaw 的 octo 插件):未装→「安装」/ 安装中→进度 / 已装→版本号 / 有更新→版本号+「升级」。
2. **cc(cc-octo)卡片 1a 不动**:维持现状(版本号 + 现有安装指引 popover),cc 一键装留给 1b。
3. **fleet 机制 = 复用 `/v1/upgrades` 放宽 install 校验**(方案 A):不新增端点/表,from_version 空 = install。
   - *不采用* 新建 `/v1/installs` 端点 + task_type(方案 B,过度)。

## 设计

### 数据链路

```
web 点「安装」
  → POST /v1/upgrades { daemon_id, space_id, component:"octo", runtime_id }   (fleet, session-auth + space/owner 校验)
  → runtime_upgrade_task 建 install 任务 (from_version 空, to_version=latest/解析)
  → daemon heartbeat/SSE 领取 → handlePluginUpgrade("octo") → npx -y create-openclaw-octo install
  → 探测 gateway + enrichDetectAndRegister 重注册
  → fleet register 时 completeUpgradeIfMatchedWithRuntime 关单
  → web 轮询 /v1/upgrades/{task_id} 见 completed → 刷新 → 版本号出现
```

### 各仓改动

**octo-web**(`feat/agent-runtime`)
- 版本槽渲染:openclaw runtime 的 `octoPlugin` 未找到 → 渲染「安装」按钮(替代/并存于现有指引);找到 → 版本号(现状);有更新 → +「升级」(现状)。
- `handlePluginInstall(runtimeId, daemonId)`:仿 `handlePluginUpgrade`,`POST /v1/upgrades { component:"octo", runtime_id, daemon_id, space_id }`(baseURL: FLEET_API_BASE)+ 复用现有轮询/进度状态。
- 状态推导逻辑(未装/已装/有更新)抽成可单测的纯函数。

**octo-fleet**(`main`)
- `upgradeInit`(`modules/runtime/upgrade.go`):对 `component` 为插件(octo/cc-octo)时,**当插件不在 runtime.plugins 里则按 install 处理**(不再 400);`from_version` 允许为空(install);`to_version` 取 latest/解析(沿用现有 provider/插件版本解析逻辑,无则置空让 daemon 装 latest)。
- 关单/状态机/sweeper/鉴权 全部沿用现有(install 与 upgrade 共用 `runtime_upgrade_task`)。
- *注:* daemon 对 "octo" 跑的 `create-openclaw-octo install` 幂等,所以即便误判 install/upgrade 也安全。

**octo-daemon-cli**(`main`,预计很小)
- 确认/放宽 `handlePluginUpgrade("octo")` 在**插件首装**(preVersion 空)时不误判失败:
  - 不因 "version did not change" / "preVersion 空" 判 failed;
  - gateway 探活:`create-openclaw-octo install` 会重启 openclaw gateway,装后探活应通;若装前 gateway 不在,探活逻辑应针对"装后"而非"装前"。
- 若现状已满足(很可能),daemon 不改;否则只动这一处判定。开发时以实际代码为准(plan 阶段精确定位)。

### 状态行为表(openclaw octo 插件)

| 插件探测结果 | 版本槽 |
|---|---|
| plugins 里无 octo | 「安装」按钮(可点) |
| 安装任务进行中(active upgrade/install for component=octo) | 进度/转圈,按钮禁用 |
| plugins 里有 octo,无更新 | 版本号 |
| plugins 里有 octo,有更新(plugin_has_update) | 版本号 + 「升级」 |

### 测试
- **web**:版本槽状态推导纯函数单测(无插件→install / 有→version / 有更新→upgrade);命令 `cd packages/dmworkbase && pnpm exec vitest run <文件>`。
- **fleet**:`upgradeInit` 对"插件不存在 + component=octo"返回建任务(非 400)的单测;Go `go test ./modules/runtime/...`。
- **daemon**:若改判定,补"对未装 octo 插件的 install 任务跑通/不误判失败"测试;`go test ./...`。

### 交付顺序(多 PR)
1. **fleet PR(→main)先合**:放宽 install 校验。否则 web 点「安装」会被 fleet 400。
2. **daemon PR(→main)**(若需要):放宽首装判定。可与 fleet 并行/先后。
3. **web PR(→feat/agent-runtime)后合**:依赖 fleet 已能受理 install 任务。

## Out of scope(明确排除)
- **1b**:cc 插件一键装、LLM 网关 url + key 收集、安全密钥流转(fleet 新表/端点)、cc-channel-octo 改代码 —— 全部不在 1a。
- 安装 base CLI(openclaw 本体):1a 前提是 daemon 已探测到 openclaw(卡片已在),只装 octo 适配插件。
- cc 卡片任何改动。
- 安装失败的复杂重试 UI(沿用现有 upgrade 的失败展示即可)。

## 风险 / 注意
- **OSS provenance**:三仓 commit/PR/注释禁 AI署名/review工具名(已固化全局 CLAUDE.md)。
- **i18n**(web):新增「安装」相关文案 key 两 locale(zh-CN/en-US)都加,避免 i18n:check 新缺失。
- **install/upgrade 幂等**:daemon 对 octo 跑同一条 install 命令,install 与 upgrade 路径合一是安全的;fleet 放宽不会引入错误执行。
- **合并顺序**:fleet 未上 web 先上 = 点了 400;plan/交付按顺序来。
