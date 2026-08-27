/**
 * FetchRules —— 埋点「中央映射·path」通道(①）的规则表 + 匹配器
 * =====================================================================
 * 背景:整合表 d_2c47796780d4efdd3c5aa8b3 里一批事件的语义是「某个后端 endpoint 被成功
 * 调用」(如"文档已创建"= POST /docs 2xx)。这些无需改任何业务组件,只要在 Dap 的 HTTP 包裹
 * (installHttpWrap)里,把**成功(2xx)**的请求 method+path 映射成对应事件名再 track 一次即可。
 * 这是收益最大、零改组件、隐私最安全的通道,故最先落地(见开发文档 §6 step 2)。
 *
 * 硬约束(与 Dap §8 隐私边界一致):
 *   - 只在 emit 内、且请求已判定第一方(同源)后才匹配 —— 跨域一律不进这里。
 *   - 只在 **2xx** 命中时触发:4xx/5xx/err 不是"动作已发生",不映射。
 *   - **匹配用的是原始 pathname,但绝不落库**:pathname 仅用于在这张静态表里选一个事件名,
 *     真正上报的 http_request.path 仍是 normalizePath() 脱敏结果;映射事件本身不带任何来自
 *     路径的值(无 object_id、无 query、无正文)。故凭证 / 文件名 / 用户名不可能借此外泄。
 *   - 事件名须以整合表为准且**已在服务端采集器注册(octo-dap 侧)**,否则前端照发、服务端丢弃。
 *
 * 匹配语义:段级通配 + 最具体优先(most-specific-wins)。
 *   - 规则 path 里以 ':' 开头的段(:id / :seg)= 单段通配,匹配任意一个实际段。
 *   - 字面段必须精确相等。段数必须相同。
 *   - 一个实际 path 可能同时匹配「字面规则」与「通配规则」(如 /issues/search 同时匹配
 *     /issues/search 与 /issues/:id)——取**通配段更少**者(更具体者)。已离线验证:表内规则
 *     在同 method 下无等具体度歧义,故该规则可完全消歧(见 dap350 碰撞分析)。
 *
 * 子区(thread)作用域策略(subchannel-inclusion policy):
 *   群设置里的一批操作在**子区**作用域会走 groups/:id/threads/:seg/... 嵌套路径,而 matchFetchEvent
 *   严格按段数匹配 —— 群级规则(N 段)永不命中子区路径(N+2 段)。策略是**子区动作滚入群级同名事件**
 *   (roll-up):子区里做的 webhook 增删改重置测试、md 编辑、子区改名,都发与群级相同的
 *   webhook_* / group_md_edited / group_name_edited,不新造带作用域后缀的事件。
 *     - 理由:这些事件的产品语义与作用域无关(「webhook 被创建」不因群/子区而不同),整合表也未区分;
 *       与其漏计子区,不如与群级归一,保证「一次手势 → 一个事件」在两级作用域一致。
 *     - 实现:凡群级有规则、子区又有平行嵌套路径的,补一条 thread 平行规则(段数+2,thread 段用 :seg)。
 *     - 段命名约定:group=:id、thread=:seg、末级资源(webhook 等)=:id —— 与 BodyRules 一致。
 *     - 若日后要在报表里拆分群/子区,应在事件属性里加 scope 维度,而非拆事件名(避免事件爆炸)。
 *   例外:conversation_left(退群/退子区)不走本表,已改命令式(见下方 message/offset 附近注释)。


/** 单条 fetch 映射规则。method 大写;path 用 ':' 段表通配;event 为整合表事件名。 */
export interface FetchRule {
    method: string
    path: string
    event: string
}

/**
 * 抑制哨兵:命中但**主动不上报**。用途 —— 当一个过宽的 `:id` 通配规则(如 /mcps/:id,历史上曾映射市场详情查看)
 * 会把某个 list / 子资源字面路径(mine / tags)误吞时,给该字面路径挂一条 event=FETCH_IGNORE 的规则。
 * 因「最具体优先」,字面(nWild=0)压过 `:id`(nWild=1),matchFetchEvent 命中它时返回 undefined → 不 track。
 * 这样删除语义错误映射后,残留路径也不会顺着通配掉进别的事件。
 */
export const FETCH_IGNORE = '__ignore__'

/** 预编译后的规则:拆好段、标好每段是否通配、记通配数(特异度)。 */
interface CompiledFetchRule {
    segs: string[]
    wild: boolean[]
    nWild: number
    event: string
}

/** buildFetchIndex 产物:按 method 分桶(大写),桶内为预编译规则。 */
export interface FetchRuleIndex {
    byMethod: Map<string, CompiledFetchRule[]>
}

/** 从原始 URL 取 pathname(去 origin / 去 query),仅供匹配用,绝不上报。解析失败返回空串。 */
export function rawPathname(rawUrl: string): string {
    try {
        return new URL(rawUrl, 'http://x').pathname
    } catch {
        return ''
    }
}

const isWild = (seg: string): boolean => seg.charCodeAt(0) === 58 /* ':' */

/** 建索引:按 method 分桶 + 预编译段。O(n) 构建,查询按桶线性(桶很小)。 */
export function buildFetchIndex(rules: FetchRule[]): FetchRuleIndex {
    const byMethod = new Map<string, CompiledFetchRule[]>()
    for (const rule of rules) {
        if (!rule || !rule.event || !rule.path || !rule.method) continue
        const segs = rule.path.split('/').filter((s) => s !== '')
        const wild = segs.map(isWild)
        const nWild = wild.reduce((n, w) => n + (w ? 1 : 0), 0)
        const compiled: CompiledFetchRule = { segs, wild, nWild, event: rule.event }
        const m = rule.method.toUpperCase()
        const arr = byMethod.get(m)
        if (arr) arr.push(compiled)
        else byMethod.set(m, [compiled])
    }
    return { byMethod }
}

/**
 * 给定 method + 原始 pathname,返回映射事件名;无命中返回 undefined。
 * 段数相同且每段(字面相等 | 任一方通配)即匹配;多命中取通配段最少者(most-specific-wins)。
 */
export function matchFetchEvent(index: FetchRuleIndex, method: string, pathname: string): string | undefined {
    const bucket = index.byMethod.get((method || 'GET').toUpperCase())
    if (!bucket) return undefined
    const actual = pathname.split('/').filter((s) => s !== '')
    let best: CompiledFetchRule | undefined
    for (const rule of bucket) {
        if (rule.segs.length !== actual.length) continue
        let ok = true
        for (let i = 0; i < actual.length; i++) {
            if (rule.wild[i]) continue
            if (rule.segs[i] !== actual[i]) { ok = false; break }
        }
        if (!ok) continue
        // 最具体优先:通配段更少者胜(离线已验证同 method 下无等具体度歧义)。
        if (!best || rule.nWild < best.nWild) best = rule
    }
    // 命中抑制哨兵 → 视作无映射(字面 ignore 规则已按最具体优先压过更宽的 :id 通配)。
    if (best && best.event === FETCH_IGNORE) return undefined
    return best?.event
}

/**
 * 「中央映射·path」通道规则表(①,整合表 d_2c47796780d4efdd3c5aa8b3)。
 * 由整合表「主要端点」列离线抽取、去碰撞后生成,再按 review 逐条对齐真实调用点。
 * 事件名须已在服务端采集器(octo-dap)注册。
 *
 * ⚠️ 只保留「端点被调用 ⇒ 用户确实做了该动作,且该动作已成功」两问皆 yes 的规则。已剔除:
 *   - 后台轮询 / 前台可见性刷新 / SDK 回调 / 重连触发的端点(会无脑放大基础指标);
 *   - 通用 profile / 列表加载类 GET(拉取 ≠ 意图/结果);
 *   - 走业务码信封(HTTP200 + code≠0 仍算失败)的 summary 成功类端点 —— 改由成功回调命令式 track;
 *   - octo-fleet / octo-docs 的越界且死(本运行时不发)规则。
 *   这些动作改由 UI 交互(data-testid / data-track / 命令式 Dap.shared.track)采集。
 */
export const FETCH_RULES: FetchRule[] = [
    // ---- im/base(/api/v1)
    // app_launched 不在此通道 —— GET /common/appconfig 也被前台可见性/focus 刷新调用(每次 alt-tab 回来
    //   都刷,见 App.tsx),请求成功 ≠ 应用启动。改为 Dap.setEnabled 首次启用分支命令式 track 一次
    //   (采集随 remoteConfig 下发 tracking_enabled 才打开,该时刻即「启动且可测」的唯一点;见 review P1-1)。
    { method: 'POST', path: '/api/v1/user/login', event: 'user_login' },
    { method: 'POST', path: '/api/v1/user/emaillogin', event: 'user_login' },
    // space_switched 不在此通道 —— POST /conversation/sync 是 WuKongIM SDK 的会话同步回调,连接/重连/冷启动
    //   都会触发,不只切换空间。改为 Pages/Main applySpaceSelection(切换确认后)命令式 track(见 review P1-3)。
    // space_join_new 不在此通道(十二审 🔴 P1-4)—— POST /space/join 对**审批制**空间返回 2xx 但用户并未加入
    //   (result.status === NEED_APPROVAL / PENDING,仅提交了申请)。path 规则对 2xx 一律计数,把「提交审批」
    //   误记成「加入新空间」——即「2xx ≠ 业务成功」,与 summary 信封门是同类问题,path 通道表达不了业务码。
    //   改为命令式:仅在 status 非审批态(真加入)时 track。收口点 = SpaceService.joinSpace(覆盖 JoinSpaceModal /
    //   JoinSpacePage)+ Layout auto-join / InviteLanding 两处直发 POST 的成功分支(均在审批 early-return 之后)。
    // message_revoked 不在此通道 —— 撤回成功后已由命令式 trackMessageRevoked 采集(带 channel_type/object_id
    //   富属性)。撤回的唯一活入口是会话菜单 vm.revokeMessage(module.tsx 的 context.revokeMessage)。
    //   若此处再挂 POST /message/revoke 的 fetch 规则,会与命令式双发(fetch 空属性 + 命令式富属性)、属性不一致。
    //   故删除 fetch 规则,统一收口到命令式单通道(见四审 P1-1;六审删除已死的气泡 onMessageRevoke 入口)。
    // subchannel_created 不在此通道 —— 子区创建成功后已由命令式 trackSubchannelCreated
    //   采集(带 source/title_len_bucket/from_msg_type 富属性)。两个活入口都走同一 POST:
    //   顶栏 createThreadByNameAndNotify('channel_toolbar')、右键 module.tsx('message_right_click')。
    //   若此处再挂 POST /groups/:id/threads 的 fetch 规则,会与命令式双发(fetch 空属性 +
    //   命令式富属性)、跨通道双计。channelUniqueness guard 只比事件名,rename 后的新名会绕过它,
    //   故显式删除 fetch 规则,统一收口到命令式单通道(见 D1;与 message_revoked 同模式)。
    { method: 'DELETE', path: '/api/v1/message', event: 'message_multiselect_deleted' },
    // channel_subchannel_panel_opened 不在此通道 —— GET /groups/:id/threads(threadList)在删除/归档/重试
    //   刷新时也会再拉,请求成功 ≠ 打开面板。二审又发现原命令式落点 ThreadList.componentDidMount 为死组件
    //   (实际渲染 ThreadPanel),永不触发;已改到 Pages/Chat/index.tsx 子区 header 开关的「仅开边沿」(见二审 P1-2)。
    // channel_search_tab_switched 不在此通道 —— POST /messages/_search_media|_search_files 每次「搜索」都发,
    //   一次输入去抖/翻页都会重打,请求成功 ≠ 切 tab。改由 ChannelSearchPanel activeTab 变化命令式 track(见二审 P1-4)。
    // group_avatar_edited 不在此通道(十二审 🔴 P1-5)—— POST /groups/:id/avatar 有两个调用方:
    //   (a) 真实「改群头像」= ChannelAvatar.saveUploadedAvatar(组件自持 HTTP 分支);
    //   (b) 建群时上传头像 = groupCreateRuntime.uploadGroupAvatar —— 建群选了张图并不是「编辑头像」。
    //   path 规则区分不了两者,建群会被误计成改头像。且真实手势自身还漏计:生成/清除头像走
    //   updateChannelAvatarCustom(PUT groups/:id {avatar_text,avatar_color,clear_uploaded_avatar}),
    //   群级 body 规则只判 name/notice、无 fallback → 那类编辑一个都不发。改为命令式:在 ChannelAvatar
    //   两处「组件自持 HTTP」的编辑成功分支各单发一次(建群走 onFileUpload/onDraftSave 早返回,天然不发)。
    // group_qrcode_viewed 不在此通道 —— GET /groups/:id/qrcode 由二维码组件挂载即拉,含缩略图/刷新/重试重复打,
    //   请求成功 ≠ 用户主动查看。改由二维码入口点击命令式 track(见二审 P1-5)。
    { method: 'POST', path: '/api/v1/groups/:id/members', event: 'group_member_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/members', event: 'group_member_removed' },
    { method: 'POST', path: '/api/v1/groups/:id/transfer/:id', event: 'group_transferred' },
    // group_md_viewed 不在此通道 —— GET /groups/:id/md 在打开群设置面板时随行渲染即拉,且编辑保存后回读也重打,
    //   请求成功 ≠ 用户查看 md。删除避免与面板打开/编辑重复计数(见二审 P1-5)。
    { method: 'PUT', path: '/api/v1/groups/:id/md', event: 'group_md_edited' },
    // 十审 🔴(相似问题):群 md 编辑器(GroupMdEditor)同一个「保存」按钮既编群 md 也编**子区(thread)md**
    //   —— isThreadMd() 时走 updateThreadMd(PUT groups/:g/threads/:t/md)。群级规则(5 段)不命中子区路径
    //   (7 段),子区 md 编辑漏计。同 webhook 一类,补一条 thread 平行规则发同一 group_md_edited。
    //   (注:md 的删除态无独立事件 —— FETCH 仅 PUT /md 计编辑,DELETE 不在通道,故不补 delete 变体。)
    { method: 'PUT', path: '/api/v1/groups/:id/threads/:seg/md', event: 'group_md_edited' },
    // group_webhook_panel_opened 不在此通道 —— GET /groups/:id/incoming-webhooks 在创建/重置/删除 webhook 后
    //   都会回读刷新列表,请求成功 ≠ 打开面板。删除避免每次增删都被计成一次「打开」(见二审 P1-5)。
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks', event: 'webhook_created' },
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks/:id/regenerate', event: 'webhook_url_reset' },
    { method: 'POST', path: '/api/v1/groups/:id/incoming-webhooks/:id/test', event: 'webhook_tested' },
    { method: 'DELETE', path: '/api/v1/groups/:id/incoming-webhooks/:id', event: 'webhook_deleted' },
    // 十审 🔴:webhook 同一批操作在**子区(thread)**作用域走 threads/:t 嵌套路径(IncomingWebhookService
    //   basePath/itemPath/regenerate/test 在 threadShortId 存在时切到 groups/:g/threads/:t/incoming-webhooks/...;
    //   ChannelWebhook UI 对群与子区共用同一套增删改重置测试按钮)。matchFetchEvent 严格按段数匹配,群级规则
    //   (5/7/7/7 段)永不命中子区路径(7/9/9/9 段) → 子区 webhook 动作被静默漏计(与 conversation_* 漏 DM/thread
    //   同类)。webhook_* 事件名本就与作用域无关,故子区动作应发同一事件。补齐四条 thread 平行规则。
    { method: 'POST', path: '/api/v1/groups/:id/threads/:seg/incoming-webhooks', event: 'webhook_created' },
    { method: 'POST', path: '/api/v1/groups/:id/threads/:seg/incoming-webhooks/:id/regenerate', event: 'webhook_url_reset' },
    { method: 'POST', path: '/api/v1/groups/:id/threads/:seg/incoming-webhooks/:id/test', event: 'webhook_tested' },
    { method: 'DELETE', path: '/api/v1/groups/:id/threads/:seg/incoming-webhooks/:id', event: 'webhook_deleted' },
    { method: 'POST', path: '/api/v1/groups/:id/managers', event: 'group_admin_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/managers', event: 'group_admin_removed' },
    { method: 'PUT', path: '/api/v1/groups/:id/bot_admin/:id', event: 'group_bot_admin_added' },
    { method: 'DELETE', path: '/api/v1/groups/:id/bot_admin/:id', event: 'group_bot_admin_removed' },
    { method: 'DELETE', path: '/api/v1/groups/:id/disband', event: 'group_dissolved' },
    { method: 'PUT', path: '/api/v1/groups/:id/members/:id', event: 'group_nickname_edited' },
    // conversation_cleared 不在此通道(十二审 🔴 P1-1)—— POST /api/v1/message/offset 是「清空会话消息」
    //   的底层端点,但同一个 clearConversationMessages 也被**删好友**(module.tsx removeFriend onOk)顺带调用:
    //   删好友时会清掉与该好友的会话消息,path 规则把它误计成一次「清空会话」。改为命令式:在两个真实的
    //   「清空」手势成功后各单发一次(clearChannelSettingMessages 与 Pages/Chat/vm.clearMessages),删好友
    //   路径直接调 provider、不经这两个入口,故保持静默。会话列表「关闭并清空」右键项经 vm.clearMessages,
    //   已被覆盖(yujiawei 确认该项本就该计,非污染)。
    // conversation_left 不在此通道 —— 原 POST /groups/:id/exit + DELETE /conversations/:id/:id 两条 fetch 规则
    //   有三个语义缺陷(十一审 🔴):
    //   (a) 退群一次手势双发 —— exitChannelSettingGroup 先 exitChannel(POST exit)、随后 deleteConversation
    //       (DELETE conversations),两条规则都命中,一次退群计两次。
    //   (b) 「关闭会话」误计 —— ConversationList.onCloseChat 走同一 DELETE conversations/:id/:id(仅本地隐藏,
    //       非退出),被计成 conversation_left。
    //   (c) 子区/DM 退出仅靠兜底 DELETE 偶发命中,且依赖 best-effort deleteConversation 的 catch 是否触发。
    //   改为命令式:exitChannelSettingGroup 在 exitChannel 成功后、leaveChannelSettingThread 在 leaveThread
    //   成功后各单发一次 Dap.shared.track('conversation_left')(见 channelSettingActions.ts)。与四审
    //   message_revoked 同款收口:真实「退出」动作成功这一刻单通道计一次,不再让 path 通道二义命中。
    //   (DM 无独立「退出」手势 —— 关闭会话是隐藏非退出,故 conversation_left 只覆盖群退出 + 子区退出。)

    // contacts_module_entered 不在此通道 —— GET /robot/my_bots 也被 BotStore / PersonaSettings 调用,
    //   不只进联系人模块。改为 apps/web 导航回调(桌面 NavRail + 低屏 tab,按 menu id 判定)命令式 track(见 review P2-4)。
    // contact_opened 不在此通道 —— GET /users/:id 是通用 profile 拉取(bot profile / 内部查库都会打),
    //   已在 Contacts handleContactClick 命令式 track(联系人行点击);删除此处避免双计(见 review P2-3)。
    { method: 'POST', path: '/api/v1/friend/apply', event: 'contact_add_friend_clicked' },
    // 注意:/api/v1/docs/* 全套(document_*)已移除 —— issue #1406 明确「24 个 octo-docs 模块事件(独立仓库/嵌入编辑器)
    //       不在本次范围」,且这些请求由**独立的 octo-docs 编辑器**发出,octo-web 运行时根本不发 → 抓不到(死规则)。
    // apps_module_entered 不在此通道(十二审 🔴 P1-3)—— GET /app_bot/available 由 useAppBots 在**每次切换空间**
    //   时经 mittBus "space-changed" 监听重拉(loadData),而 Apps 页首次访问后就常驻 DOM(MainContentLeft 只切
    //   display 不卸载),所以用户打开过一次 Apps 后,在 Chat/Contacts 任意处切空间都会误发 apps_module_entered;
    //   重试按钮是第三个触发源。反过来:组件常驻 → 从别处切回 Apps 不发 GET,真实再进入反而漏计。改为命令式:
    //   在导航真正切到 Apps(menus.id === 'appbot')时计一次,与 contacts_module_entered 同款(桌面 NavRail +
    //   低屏 tab 两处对称;重复点当前菜单不计)。
    { method: 'PUT', path: '/api/v1/user/language', event: 'language_switched' },
    // 注意:settings_menu_opened 不在此通道。/version.json 由 versionChecker 定时轮询(cache-bust),
    // 请求成功 ≠ 用户打开设置 —— 该事件改由「设置入口」点击(data-testid / 命令式 track)采集。
    // settings_voice_opened 不在此通道 —— GET /voice/local-config 由语音设置组件挂载即拉,且被设置页其他
    //   子面板/焦点刷新连带调用,请求成功 ≠ 用户打开语音设置。改由语音设置入口点击命令式 track(见二审 P1-3)。
    // settings_voice_toggled 不在此通道(十二审 P2)—— PUT /voice/local-config 被两个手势共用:真实开关
    //   handleLocalToggle({enabled}) 与保存 URL 配置 handleLocalConfigSave(原样带 enabled),编辑 URL 被误计成
    //   切换。改由 handleLocalToggle 成功后命令式 track(仅真实切换)。reset 走 POST /voice/local-config/reset,不受影响。
    // settings_secrets_opened 不在此通道(十二审 🔴 P1-2)—— GET /api/v1/manager/secrets 是密钥面板的**列表加载**,
    //   SecretsSettingsPanel.load() 在挂载、删除后刷新、新增/编辑保存后(onSaved)、以及错误态重试时都会重拉,
    //   一次打开面板 + N 次增删改会被计成 N+1 次「打开」。改由面板挂载命令式 track 一次(与 settings_voice_opened
    //   同款,见 VoiceSettingsPanel)。POST/PUT manager/secrets(真实写=配置)仍保留在下方。
    { method: 'POST', path: '/api/v1/manager/secrets', event: 'settings_secrets_configured' },
    { method: 'PUT', path: '/api/v1/manager/secrets/:id', event: 'settings_secrets_configured' },
    { method: 'POST', path: '/v1/auth/oidc/:seg/logout', event: 'user_logout' },
    // ---- fleet(task/project/expert/skill/workspace/automation)全套已移除 ----
    //   issue #1406 明确「133 个 octo-fleet 事件(独立 SPA)不在本次范围」;且这些 /fleet/api/v1/* 请求
    //   由**独立的 octo-fleet SPA** 发出,octo-web 运行时(Dap 所在)根本不发这些请求 → 抓不到(死规则)。
    // ---- summary
    // 本模块**整体不在 path 通道**。两类原因:
    //  (1) GET 只证明「拉取」不证明「意图/结果」,改由 UI 采集:
    //   smart_summary_create_clicked        ← 「新建总结」按钮点击(GET /summary-templates 是页面 init 加载)
    //   smart_summary_scope_channel_selected ← 勾选 channel 的 onChange(GET /summary-chat-candidates 只加载候选)
    //   smart_summary_scope_participant_selected ← 勾选 participant 的 onChange(GET /summary-member-candidates 同理)
    //   smart_summary_completed              ← 详情响应 status===completed 时命令式 track(GET /summaries/:id 对失败/进行中/导航都会 2xx)
    //   smart_summary_agent_message_sent     ← AgentChatPanel.handleSend 命令式 track(覆盖点击+Enter;见 review P1-4)
    //  (2) summary 走 {code,message,data} 信封 —— HTTP200 + code≠0 是**逻辑失败**,2xx 通道会把失败也计成
    //      成功(见 review P1-5)。故所有成功类 mutation 事件改由 summaryApi.ts 在 api 层按 code===0 gate 后
    //      命令式 track(trackOnEnvelopeSuccess):smart_summary_started / _edited / _regenerated / _deleted /
    //      _timer_configured / _custom_template_created。此处不再挂任何 /summary/api/v1/* 规则。
    // ---- market
    // 注意:market_view_switched / market_tag_filtered 不在此通道 —— «mine» 列表也用于建议/初始化,
    //       tag 列表在 init/搜索时加载,请求成功 ≠ 用户切视图/选标签。改由 Tab / tag chip 点击采集。
    // 卡片打开(市场详情)也不在此通道 —— GET /mcps|skills/:id 既被「点卡片看详情」拉,也被「卡片 ⋯ 菜单→编辑」
    //   (handleEditFromCard→fetchMcpDetail)拉,fetch 层无法区分看/编,编辑会被误计成查看(见二审 P2-1)。
    //   改由卡根 data-track="market_card_opened"(DOM 委托,亦覆盖键盘)采集;这里把 /:id 钉成 IGNORE,
    //   同时继续压过 mine/tags/versions。(六审 C2:已删除曾并存的命令式 market_card_viewed,避免同一次打开双计。)
    //   2026-08-21 市场切统一插件接口:目录读写走 /plugins/*,规则整体换新。保留的工具端点
    //   POST /mcps/_probe 与 POST /mcp_icon_uploads 仍会发起(非目录数据,无事件规则命中)。
    //   新路径全部是字面段(无 :id 通配),不存在误吞,故旧的 mine/tags/:id IGNORE 钉子不再需要;
    //   列表 GET /plugins、详情 GET /plugins/detail、标签 GET /plugin_tags 依旧不挂事件(同旧决策:
    //   请求成功 ≠ 用户意图,卡片打开走 data-track="market_card_opened")。
    //   market_manual_publish_submitted 的新映射:skill 新建/重传 = POST /plugins/import;MCP 新建
    //   在 upsert 后必发 POST /plugins/publish。两者都是「发布提交」;副作用是 skill 版本 bump 的
    //   publish 也会计入(语义上仍是发布提交,可接受)。纯元数据编辑只走 POST /plugins/upsert,
    //   刻意不映射 —— upsert 新建/编辑同端点,fetch 层分不出意图(同 mcps/:id 看/编不可分的老问题)。
    // NOTE: /plugins/versions is type-agnostic, but this rule maps it to the
    // SKILL history event. FetchRules matches on path only (no plugin_type), and
    // today the sole caller is skillApiReal (skill version history). If a
    // connector/expert version-history caller is ever added, it will silently
    // emit market_skill_version_history_viewed — split the metric by type then.
    { method: 'GET', path: '/market/api/v1/plugins/versions', event: 'market_skill_version_history_viewed' },
    { method: 'POST', path: '/market/api/v1/plugins/import', event: 'market_manual_publish_submitted' },
    { method: 'POST', path: '/market/api/v1/plugins/publish', event: 'market_manual_publish_submitted' },
]
