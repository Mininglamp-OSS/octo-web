# 统一总结：原生 Octo 分流清单与后续开发顺序

整理日期：2026-09-09。更新：原生入口和单人动作切片已开发并完成隔离镜像验收；整体方案未完成，尚不提 PR。第 1–5 节保留开发前检查快照及当时行号，当前完成范围以本节和实施记录为准。

## 本轮实施结果（2026-09-09）

1. 已接入 C1 轻量列表投影、共享列表/Catalog 能力判定，以及 A1–A4、B1/B5 和 D1 的单人动作链。卡片不再按 Agent/Workflow 分类，列表/主工作区/聊天侧栏的“继续优化”进入原详情。引用资格不再由引擎推断；正式能力失败不回退旧写入。
2. B3 已统一列表新建按钮，但完整新建流程 B4、初次 V1 写入 E1、非试点 D2–D4 及团队/成员执行仍未完成。保留内部兼容适配，不能称批次一或整体方案全部结束。
3. 前端 89 文件 / 1,282 测试、生产 Web 构建、i18n；后端全量 race（含真实 MySQL）和 vet 通过。类型检查仍失败：6,062 条，上一轮 6,035 条，上游基线 6,025 条；不能用构建成功替代类型门禁。
4. 原生镜像 `28360` 已更新，API/Worker 为 `octo-summary-execution:native-actions-20260909`，Web 为 `octo-web:native-actions-layout-20260909`。历史任务 56（Agent）、52（Workflow）经同一列表菜单在原任务生成 V2，V1 保留；总任务数仍 58。任务 58 因测试模型引用 `[1]` 不在其证据集中失败，V1 保留并有可见提示。模型为本地合成响应，非生成质量验收。
5. 配置入口在原详情可用，表单超高问题经浏览器发现后改为内部滚动。未保存新定时计划、未覆盖 V1、未发真实通知；原 28140、诊断 28350 和旧容器均保留。两账户、完整多人流程、各视口/主题完整验收及类型问题仍是 PR 门禁。

详细证据见[实施记录](/home/mlamp/worktrees/summary-versioning-frontend/docs/unified-summary-versioning-implementation.md:1)。下一切片先处理 B3/B4 的正式新建与 E1 的初次 V1 协调，再继续非试点详情与全部写入者；不要重复实现本轮已通过的列表投影。

## 1. 基线、范围与结论

以用户指定的官方仓库 `main` 为产品基线，2026-09-09 用 `git ls-remote <repository> refs/heads/main` 核对：

| 仓库 | 官方 main HEAD | 开发工作树 HEAD |
|---|---|---|
| Mininglamp-OSS/octo-web | `2a41ee1d21c1a86ae924052e3f4bcd0edfb83a20` | `6b3ed2029a874ce765049aaa39b217e4bd1e70db`，另有未提交改动 |
| Mininglamp-OSS/octo-smart-summary | `391134cc8c25226287e58a26204616d42a200e6d` | `011ce5ccc295f2ff419516b953ed3e99cea3a09d`，另有未提交改动 |

开发目录分别是 `/home/mlamp/worktrees/summary-versioning-frontend` 和 `/home/mlamp/worktrees/summary-versioning-backend`，分支均为 `codex/unified-summary-versioning`。两条开发分支包含上述官方基线。原始[方案](/home/mlamp/octo-smart-summary/agent-workflow-unified-summary-versioning-plan.md:1)记录的前端 `9e33837a` 是更早的核对点，不再作为本轮基线；这不改变方案中的产品规则。

问题不是拿错前端仓库，而是尚未完成所要求的产品收口：列表的分类、菜单和入口仍保留官方 main 的旧分流；本地新增的原生详情接入只覆盖单人试点。下文行号定位到本次检查时的开发工作树，后续以函数名辅助定位。

| 已有内容 | 尚未覆盖的边界 |
|---|---|
| 内容 ID、版本适配、编辑/恢复 CAS、持久化生成、取消和冲突候选基础 | 初次正式保存及所有旧写入者尚未统一接入 |
| 单人、创建者本人、已完成内容的配置和实际定时执行试点 | 按群结果、团队轮次、成员报告执行，以及生成事件通知 |
| 原生详情中的无界面数据绑定、编辑器保存适配、历史侧栏和配置弹窗 | 列表、新建、聊天侧栏、参考选择器、非试点详情没有整体收口 |
| `28360` 使用完整 Octo 外壳 | 仍有引擎分流，不是需求验收通过；`28350` 只是诊断宿主 |

原始清单整理阶段只修改文档和恢复检查点；后续实施已发生，见本文开头。镜像数据未重置，仍未推送或提交 PR。

## 2. 行为清单：用户看到的应当是什么

1. **一个入口。** 在现有 Octo 总结模块和聊天侧栏中保留“新建总结”，不再让用户选择 Agent/Workflow/快速总结；复用原有导航、Workbench 和详情布局，不另建工作台。
2. **一个操作目标。** “继续优化”默认作用于当前总结的主内容或明确选中的“我的报告”。成功只给该内容追加版本，`task_id`、`content_id` 不变；“参考这份总结”和“另存为新总结”是独立意图。
3. **一套动作规则。** 列表和详情共用服务端能力、内容状态、配置状态和运行状态。相同业务范围、权限及配置的历史 Agent/Workflow 总结获得相同行为。缺少可重放配置只限制重新检索，不阻止有权限的正文优化；补配置必须让用户确认。
4. **保留业务和安全差异。** 单人、按群、团队最终结果、本人报告的归属不同；定时状态和创建者身份也不是引擎类型。团队只有一人提交仍是团队。无权限、加载中、请求失败、切换 Space、已删除等状态不得开放写入。
5. **统一正式版本语义。** 优化/重新生成成功追加版本；编辑和恢复覆盖当前版本并增加修订号，不增加版本、不切到历史指针，覆盖前需提示。生成中、冲突候选、刷新恢复状态采用同一规则；对话预览不冒充正式版本。

验收对象是有相同业务条件的两条历史总结，不要求不同权限或不同协作范围的所有卡片拥有相同按钮。`referenceable=true` 只代表可作参考，不能当作编辑或优化授权。

## 3. 文件地图与分流处置

优先级：P0 是首要需求及防止错误写入的必要项；P1 是完整交付必须补齐的项。以下“目标/处理”均为待开发项。保留内部执行器和兼容适配，不做全仓 `Agent` 字符串删除。

### 3.1 展示和列表动作

| 编号 / 优先级 | 位置与现状 | 目标/处理 | 依赖与回归 |
|---|---|---|---|
| A1 / P0 | [summaryHelpers.ts:240](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/utils/summaryHelpers.ts:240)：`isReferenceable` 缺字段就按 Agent 推断；`getSummaryTypeKind`（258）分类为 agent/scheduled/multi/quick | 将引用资格与展示元数据分开；产品不展示引擎分类；协作范围和定时状态来自可信业务字段，不从引擎或本轮成功人数推断 | 依赖 C1；成对历史数据的标题、图标、提示和可访问名称一致 |
| A2 / P0 | [SummaryCard.tsx:175](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/SummaryCard.tsx:175)：图标、CSS 类、Tooltip、aria-label 都按类型；234/244 行菜单按 `unifiedAgentActions && typeKind` 分流 | 卡片只渲染统一动作模型，去掉按引擎提供“优化”或“编辑/重新生成”的判断；保留创建者/参与者、删除/退出区别及 Bot 代创建归属说明 | 依赖 C1、B1；测试不能只检查可见文案，还要检查菜单动作和目标 |
| A3 / P0 | [SummaryListPage.tsx:659](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryListPage.tsx:659)：重试/取消直调旧 API；编辑/重生成依赖 300ms 后全局事件；689 行优化可发参考事件；976 行以全局 Workbench 可用性决定菜单 | 动作通过 Service/bridge 和明确路由意图收口；进入详情后待目标加载再执行，不依赖定时猜测。正式任务取消按运行身份处理，已失败任务重试不拿标题冒充生成要求 | 依赖 C1、B1、D1；慢加载、刷新、连点、失败保留旧正文及正式任务零旧写入调用 |
| A4 / P0 | [index.css:511](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/index.css:511)、[中文文案:236](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/i18n/zh-CN.json:236)、[英文文案:711](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/i18n/en-US.json:711)：类型样式和 Agent/Quick 文案 | 跟随实际调用点移除引擎标签；不改共享主题，不删除内部诊断/执行器术语，也不重写用户已有总结标题 | A1–A3 完成后检查中英、明暗、无障碍名称；先读项目 i18n 指南 |

### 3.2 新建、继续优化和参考入口

| 编号 / 优先级 | 位置与现状 | 目标/处理 | 依赖与回归 |
|---|---|---|---|
| B1 / P0 | [SummaryWorkspace.tsx:68](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/workspace/SummaryWorkspace.tsx:68)：创建路由保留模式；`continueRefine`（76）进入 create+agent+derivedFromTask；[ChatSummaryPanel.tsx:141](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/ChatSummaryPanel.tsx:141)同样进入新建 | 定义 new / refine-existing / reference / save-as-new 意图；优化必须携带明确任务和内容目标。主工作区与聊天侧栏接同一动作协议 | C1、D1；从列表、详情、聊天侧栏点击优化均不进入另建任务保存链；保留会话上下文和返回行为 |
| B2 / P0 | [legacyNavigation.tsx:129](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/integration/legacyNavigation.tsx:129)：参考事件转新建；[SummaryWorkbenchFeature.tsx:112](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/features/summaryWorkbench/SummaryWorkbenchFeature.tsx:112)将 `derivedFromTask` 仅放入参考集合 | 旧 URL 和参考事件继续兼容，但不再用它们实现“修改已有总结”。参考只读材料不能自动成为写入目标；路由刷新不能重复提交 | B1；断言参考流程不改变原文，优化流程不新增任务，保存失败后重试不重复创建 |
| B3 / P0 | [SummaryListPage.tsx:791](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryListPage.tsx:791)仍有两类创建菜单；[SummaryWorkbenchCreateEntry.tsx:60](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/features/summaryWorkbench/SummaryWorkbenchCreateEntry.tsx:60)回退旧创建页并传模式 | 已启用统一能力的交付范围保持一个入口；保留明确的加载、不可用和重试状态，不能网络失败后重新露出模式选择，也不能强行调用未支持的后端 | 保留 [Entry.tsx](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/features/summaryWorkbench/Entry.tsx:1) 的 Space/能力安全边界；测试未启用、缺能力、错误、切换 Space。灰度外旧行为不算统一已交付 |
| B4 / P0 | [SummaryCreatePage.tsx:1253](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryCreatePage.tsx:1253)：模式决定对话/表单；1574/1646 行决定成员和提交入口 | 正式新建复用已有 Workbench；按确认的单人/团队业务范围选择能力，不让原始引擎决定能否协作。内部 `trigger_mode`/执行器请求暂通过兼容 adapter 保留，不直接删接口 | E1、E3；创建预览多次只在显式保存时生成一次 V1；单人不暴露邀请其他作者，团队仍能走完整协作 |
| B5 / P0 | [SummaryReferencePicker.tsx:86](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/SummaryReferencePicker.tsx:86)：缺 `referenceable` 切 legacy 并仅查 Agent；189/248 行复用引擎标签 | 正式契约使用服务端可引用状态，无引擎筛选；缺字段不得猜测授权。保留分页收集、去重、过期响应保护和错误状态 | 后端已有 [referenceableFromLoaded](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/reference_artifact.go:231)，不重复发明规则；覆盖首页无可用项但后页有、空正文、跨用户和跨 Space |

### 3.3 服务端能力与前端适配

| 编号 / 优先级 | 位置与现状 | 目标/处理 | 依赖与回归 |
|---|---|---|---|
| C1 / P0 | [SummaryListItem](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/types/summary.ts:175)和[列表响应 task.go:781](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/task.go:781)没有正式目标/逐项动作能力投影 | 首选在列表响应增加轻量投影：协议状态、主内容身份、业务范围、配置状态、允许动作及原因、必要运行摘要；不返回正文/私有证据，不按卡片逐个请求完整 Catalog | 与 C2 共享服务端判定，批量读取避免 N+1；列表信息只决定展示，执行命令仍重新鉴权和校验基线 |
| C2 / P0 | [content_read.go:212](/home/mlamp/worktrees/summary-versioning-backend/internal/service/content_read.go:212)：写能力仅在 `requireSingleGeneration` 且已有完成内容等条件满足时开放；[generation_config.go:54](/home/mlamp/worktrees/summary-versioning-backend/internal/service/generation_config.go:54)只支持创建者本人的单人内容 | 先投影当前真实能力，不承诺未实现范围；后续按内容归属及配置可执行性扩展。引擎来源不能充当权限；读历史权限不等于恢复权限，取消还需运行权限 | E1–E3；支持/不支持范围、只读用户、已退出成员、活跃生成和损坏配置的前后端契约一致 |
| C3 / P0 | [NativeFormalContentBinding.tsx:39](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/features/summaryWorkbench/NativeFormalContentBinding.tsx:39)：取主内容，靠 managed/configure/refine 能力决定 formal/legacy；目前不是多目标选择器 | 复用现有 Service/bridge，区分“协议不可用”和“无写权限”；扩展 main / my-report 目标绑定，状态按 Space+task+content 隔离。已纳管任务读取失败不得回退旧写入 | C1、C2；只读用户仍可看获准历史；旧响应不能覆盖新 Space/任务/目标的控制器 |
| C4 / P0 | [content_rollout.go:17](/home/mlamp/worktrees/summary-versioning-backend/internal/service/content_rollout.go:17)、[router.go:104](/home/mlamp/worktrees/summary-versioning-backend/internal/api/router/router.go:104)：精确灰度、粘性协议标记、旧写入阻断和历史清理保护 | 必须保留。先接完写入者再扩范围，不能只移除 guard、开全 Space 写入或把 409 当成功。已有执行/读开关并不代表完整功能已支持 | 并发纳管/旧回调/清理测试；未授权 Space 不开放命令；镜像之外不改灰度值 |

拟复用 [SummaryContentService.ts](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/Service/SummaryContentService.ts:1) 和 [SummaryContentContract.ts](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/Service/SummaryContentContract.ts:1)；统一动作视图模型、目标解析和待执行意图放在既有 `bridge/summaryWorkbench` / `features/summaryWorkbench` 分层中。具体新增文件名在实施该批时确定，不把完整流程继续堆进页面类或共享组件。

### 3.4 原生详情、版本和定时展示

| 编号 / 优先级 | 位置与现状 | 目标/处理 | 依赖与回归 |
|---|---|---|---|
| D1 / P0 | [SummaryDetailPage.tsx:2407](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2407)：formal 分支已有原地优化；legacy `handleContinueRefine` 仍可经父回调进入参考新建 | 沿用原生标题、正文、引用和操作区；收口按钮到显式内容命令，页面仅作薄适配。优化默认冻结现有正文，不自动重读聊天 | B1、C3；两类历史单人总结经过相同入口，各自产生 V2；未选择重新检索时没有检索调用 |
| D2 / P0 | [SummaryDetailPage.tsx:2730](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:2730)的旧版本上下文排除 Agent；[SummaryVersionPanel.tsx:35](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/SummaryVersionPanel.tsx:35)仍写“仅 Workflow” | 扩展既有正式历史侧栏适配，统一不透明版本 ID 和内容修订；保留两类存储 adapter，不混用裸整数。恢复历史和应用冲突候选是不同操作 | C3、E2；超过 5 版本可翻页；编辑/恢复不增版本且不能静默修改未来生成配置 |
| D3 / P0 | [SummaryDetailPage.tsx:3113](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3113)、[3232](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3232)、[3293](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:3293)：旧完成页/本人报告仍有引擎编辑限制和 Agent 标记 | 以内容目标、归属、状态和能力替换；继续使用编辑器正式保存适配和冻结基线；保留团队结果/我的报告区分 | C2、C3；创建者不能因此获得他人个人报告权限；成员报告不进入团队结果版本列表 |
| D4 / P0 | [SummaryDetailPage.tsx:4178](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:4178)无条件隐藏 Agent 定时信息；[4382](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:4382)旧设置入口也排除 Agent | 定时信息由计划状态/查看权限决定，设置由配置与权限决定。区分“可配置”“需补全”“不可执行”，不以引擎名解释能力 | C2、E3；相同计划两类历史内容显示一致；参与者可读计划不等于可改计划 |
| D5 / P1 | [SummaryDetailPage.tsx:4379](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/SummaryDetailPage.tsx:4379)按 formal `can_delete` 隐藏删除，而[能力生成](/home/mlamp/worktrees/summary-versioning-backend/internal/service/content_read.go:227)当前不开放 delete/save-as-new | 补齐任务删除和内容另存为的独立能力/入口。删除已有后端取消运行保护，不能称为全无实现；仍需统一菜单、权限及确认范围 | E4；删除与迟到回调竞态；另存为单人新任务 V1、不修改原文、不默认复制计划。含 `[Pn]` 的团队另存为仍待范围确认 |

### 3.5 正式写入与执行依赖

| 编号 / 优先级 | 位置与现状 | 目标/处理 | 回归要求 |
|---|---|---|---|
| E1 / P0 | [CreateAgentSummary](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/agent_summary.go:570)仍事务创建任务、参与者和 `PersonalResult`；[agent_summary_save.go](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/agent_summary_save.go:77)已有预览校验/幂等；[CreateSummary](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/task.go:347)是另一创建链 | 将显式保存及初次生成接入正式 V1 提交；保留已存在的预览、证据、权限和幂等保护。两套执行器可以保留，但最终提交遵守公共协议 | 多轮预览不产生多份正式 V1；重复保存不重复建任务；参考保存不覆盖参考源；快照不能把标题猜成生成要求 |
| E2 / P0 | [edit.go](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/edit.go:142)、[personal_refine.go](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/personal_refine.go:142)、[personal_processor.go](/home/mlamp/worktrees/summary-versioning-backend/internal/worker/personal_processor.go:86)已有旧写阻断；[meta_processor.go](/home/mlamp/worktrees/summary-versioning-backend/internal/worker/meta_processor.go:83)仍有团队聚合执行链 | 逐个把正式内容提交适配到统一协调器；阻止旧写入只是安全护栏，不是该写入者已完成接入。保留原有执行器、引用解析和成员并行 | 同内容互斥、整轮任务互斥、成员子任务可并行；冻结聚合输入；旧版本清理不得删第 6 个及以后的已保留正式版本 |
| E3 / P1 | [generation_scheduler.go:43](/home/mlamp/worktrees/summary-versioning-backend/internal/service/generation_scheduler.go:43)和[confirmed_generation.go:13](/home/mlamp/worktrees/summary-versioning-backend/internal/worker/confirmed_generation.go:13)支持正式单人执行；旧[scheduler.go:201](/home/mlamp/worktrees/summary-versioning-backend/internal/worker/scheduler.go:201)仍会快照后删除重建个人/成员等行 | 扩展配置验证及执行 adapter 到按群/团队/成员；纳管任务保持稳定内容身份，重置轮次状态但不删除旧当前内容。单人已有到点执行不重做 | 真正等调度到点；执行槽位幂等、固定时间锚、改配置不改在途输入；失败/取消保留当前内容，轮次重建不重置修订 |
| E4 / P1 | [content_rollout.go:154](/home/mlamp/worktrees/summary-versioning-backend/internal/service/content_rollout.go:154)和[DeleteSummary](/home/mlamp/worktrees/summary-versioning-backend/internal/api/handler/task.go:1938)已有删除取消运行；旧通知挂在[notifyTaskTerminal](/home/mlamp/worktrees/summary-versioning-backend/internal/worker/processor.go:138)等任务状态链 | 对接 generation 级持久化完成事件、去重投递及未读更新；补齐删除/退出/成员变更对运行的授权约束。纯正文优化不误发完成通知 | 通知重试不重复；定时新版本产生正确未读；删除后迟到输出不能复活任务；无外部真实通知的本地受控测试 |

## 4. 开发批次与 PR 范围

按以下顺序推进；批次是本地交付切片，不表示现在就提交 PR。第一批不能仅改标签后更新镜像宣称完成。

1. **批次一：原生入口和单人行为收口。** 实施 A1–A4、B1–B5、C1–C4 及 D1–D4 的单人接入。先补轻量能力投影和动作模型，再接列表/详情/聊天侧栏。出口：两类历史单人总结在相同权限下走同一动作链；优化原对象，能力不足清楚说明原因，错误不退回旧写入。
2. **批次二：所有正式写入。** 实施 E1、E2，补齐初次 V1、重试、编辑、恢复、优化和重新生成。出口：新建与历史数据都遵守目标身份、版本和 CAS 规则；不能以“后端拒绝了旧操作”代替接通。
3. **批次三：配置与真实定时范围。** 实施 E3，并扩展 C2/C3/D4 的按群、团队最终结果和本人报告支持。出口：配置保存、实际到点执行、冻结轮次、成员并行及旧正文保留全部有镜像证据。
4. **批次四：通知和生命周期闭环。** 实施 D5、E4，补齐删除/退出/成员权限变化、生成事件通知和单人另存为。含成员引用的团队另存为不自行扩大范围，到该切片前确认。
5. **批次五：完整 Octo 镜像验收后提 PR。** 用正常 Web/API/Worker 构建、原有导航和保留的历史数据验收；记录主仓库基线、构建版本、数据来源与真实/模拟依赖。前后端分别整理聚焦的 PR，全部门槛通过前不推送。

PR 只覆盖总结模块及所需后端契约/执行协调，不夹带 Octo 外壳重做、登录改造、共享主题改造、其他功能清理或物理版本表合并。现有修改与镜像数据均保留；文档中的绝对路径是本地开发定位信息，提交前可另作可移植引用整理。

## 5. 验证计划与本轮检查

### 自动化和人工验收

1. **成对夹具。** 两条记录只改变历史引擎来源，其余归属、配置、权限和状态相同。扩展现有 [SummaryCard.test.tsx](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/SummaryCard.test.tsx:1)、[modeEntry.test.tsx](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/pages/__tests__/SummaryListPage.modeEntry.test.tsx:1)、[SummaryWorkspace.test.tsx](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/workspace/SummaryWorkspace.test.tsx:1)、[ChatSummaryPanel.test.tsx](/home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary/src/components/__tests__/ChatSummaryPanel.test.tsx:1)；同时断言文案、图标、aria-label、菜单、目标和 API 调用，而不是仅改旧快照让测试通过。
2. **契约与异常。** 在 Service/bridge、ReferencePicker、NativeFormalContentBinding、详情已有测试中覆盖能力缺失/403/404/409/超时、Space 切换、目标切换、页面慢挂载、刷新不重复提交；正式任务不得回退旧 API。后端验证列表/详情/执行三处判定一致，批量投影不泄露他人报告或产生 N+1 查询。
3. **真实数据库和执行。** 使用隔离 MySQL 验证 V1 幂等、编辑/恢复不增版本、优化增版本、6+ 历史保留、候选应用、过期租约、取消和迟到回调；使用实际 Worker 调度而非手工调用生成来冒充定时通过。配置 CAS 和请求幂等均需并发连接测试。
4. **原生人工路径。** 正常 Octo 登录后，从 `/summary`、聊天侧栏、详情和参考选择器分别进入；检查返回/刷新、两账户、历史 Agent/Workflow、单人/团队/本人报告与 `[n]`/`[Pn]` 隔离。新 UI 先 Story 再接业务，验证中英、明暗、加载/空/错误和窄屏；保持线上基线的原生布局。
5. **发布门槛。** 跑完整 Summary 单测、i18n、生产 Web 构建、类型检查与后端 race/vet；修复或明确处置新增类型问题，不能将 build 成功说成 typecheck 成功。镜像验收记录具体版本与失败项；现存诊断宿主测试不能替代完整系统验收。

前端可复用的命令（本轮文档整理未重跑业务测试）：

```bash
pnpm --dir /home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary test
pnpm --dir /home/mlamp/worktrees/summary-versioning-frontend/packages/dmworksummary typecheck
pnpm --dir /home/mlamp/worktrees/summary-versioning-frontend i18n:check
pnpm --dir /home/mlamp/worktrees/summary-versioning-frontend --filter @octo/web build
```

后端在 `/home/mlamp/worktrees/summary-versioning-backend` 使用 `go test -race ./... -count=1` 和 `CGO_ENABLED=0 go vet ./...`。race/数据库用例需先按[已有验证说明](/home/mlamp/worktrees/summary-versioning-backend/docs/unified-summary-versioning-verification.md:20)准备本机 native tokenizer 依赖和隔离 MySQL；不能让数据库用例被跳过后报告全通过。测试凭据不写入文档或聊天。

| 本轮核对项 | 结论 |
|---|---|
| 官方 main 与当前工作树 | 已检查；两个工作树保留未提交开发内容 |
| 分流来源 | main 的卡片/helpers/列表仍未改；当前新增详情绑定仅单人试点，不能算整体收口 |
| 上次测试证据 | [native-detail-vitest-final.log](/home/mlamp/worktrees/summary-versioning-frontend/.codex/native-detail-vitest-final.log:1)记录 88 文件 / 1,266 测试通过；不是本轮新增验收结果 |
| 尚未通过的门槛 | 完整统一行为验收、团队/生命周期等剩余实现；前次类型检查 6,035 项对比基线 6,025 项，新原生改动后尚未复核 |
| 本轮变更边界 | 仅清单、文档索引和恢复检查点；链接/行号及差异空白校验结果见恢复检查点 |

原始计划的 C1/B1/A3 切片已通过成对测试，当前下一步见本文开头的实施结果。
