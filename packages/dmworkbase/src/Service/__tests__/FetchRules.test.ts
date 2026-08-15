import { describe, it, expect } from 'vitest'
import { FETCH_RULES, FETCH_IGNORE, buildFetchIndex, matchFetchEvent, rawPathname, type FetchRule } from '../FetchRules'

/**
 * FetchRules —— 中央映射·path 通道(①)的匹配器与规则表守卫。
 * 重点:段级通配 + most-specific-wins 的正确性;method 分桶;rawPathname 隐私(去 query/origin);
 * 以及规则表本身的两条不变量(同 method 无等具体度歧义、事件名/形状齐全)——它们是"0 残留碰撞"
 * 结论的运行时钉子,后续增删规则若破坏立即红。
 */

describe('FetchRules — matchFetchEvent 语义', () => {
    const rules: FetchRule[] = [
        { method: 'GET', path: '/fleet/api/v1/issues/search', event: 'task_board_filtered' },
        { method: 'GET', path: '/fleet/api/v1/issues/:id', event: 'task_opened' },
        { method: 'POST', path: '/fleet/api/v1/issues/:id/comments', event: 'task_commented' },
        { method: 'DELETE', path: '/fleet/api/v1/issues/:id', event: 'task_deleted' },
    ]
    const idx = buildFetchIndex(rules)

    it('字面段精确命中', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/search')).toBe('task_board_filtered')
    })

    it('通配段匹配任意单段', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/12345')).toBe('task_opened')
        expect(matchFetchEvent(idx, 'POST', '/fleet/api/v1/issues/abc/comments')).toBe('task_commented')
    })

    it('most-specific-wins:字面规则压过通配规则(/issues/search 不落到 :id)', () => {
        // search 同时能匹配 /issues/search 与 /issues/:id,取通配更少者。
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/search')).toBe('task_board_filtered')
    })

    it('method 分桶:同 path 不同 verb 命中不同事件', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/x')).toBe('task_opened')
        expect(matchFetchEvent(idx, 'DELETE', '/fleet/api/v1/issues/x')).toBe('task_deleted')
    })

    it('method 大小写无关', () => {
        expect(matchFetchEvent(idx, 'get', '/fleet/api/v1/issues/x')).toBe('task_opened')
    })

    it('段数不同 / 未知 method / 无命中 → undefined', () => {
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/fleet/api/v1/issues/x/y')).toBeUndefined()
        expect(matchFetchEvent(idx, 'PUT', '/fleet/api/v1/issues/x')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/nope')).toBeUndefined()
    })
})

describe('FetchRules — rawPathname 只取路径(隐私:去 query / 去 origin)', () => {
    it('相对 URL', () => {
        expect(rawPathname('/api/v1/docs/42/view')).toBe('/api/v1/docs/42/view')
    })
    it('绝对 URL 去 origin', () => {
        expect(rawPathname('https://x.example.com/api/v1/docs/42/view')).toBe('/api/v1/docs/42/view')
    })
    it('去 query,不泄露 query 值', () => {
        const p = rawPathname('/api/v1/messages/_search_files?q=secret')
        expect(p).toBe('/api/v1/messages/_search_files')
        expect(p.includes('secret')).toBe(false)
    })
    it('空串经 base 解析为 "/"(无害:匹配不到任何规则)', () => {
        expect(rawPathname('')).toBe('/')
    })
})

describe('FETCH_RULES — 规则表不变量', () => {
    it('每条规则形状齐全(method 大写 / path 以 / 开头 / event 非空)', () => {
        for (const r of FETCH_RULES) {
            expect(r.method, r.event).toBe(r.method.toUpperCase())
            expect(r.path.startsWith('/'), `${r.event} path=${r.path}`).toBe(true)
            expect(r.event.length).toBeGreaterThan(0)
        }
    })

    it('同 method 下无"等具体度且路径重叠"的真歧义(most-specific-wins 可完全消歧)', () => {
        // 两条规则重叠 = 段数相同且逐段(字面相等 | 任一方通配);重叠且通配数相等 → 真歧义。
        const isWild = (s: string) => s.startsWith(':')
        const segs = (p: string) => p.split('/').filter(Boolean)
        const overlap = (a: string, b: string) => {
            const A = segs(a), B = segs(b)
            if (A.length !== B.length) return false
            return A.every((x, i) => isWild(x) || isWild(B[i]) || x === B[i])
        }
        const nWild = (p: string) => segs(p).filter(isWild).length
        const byMethod = new Map<string, FetchRule[]>()
        for (const r of FETCH_RULES) {
            const arr = byMethod.get(r.method) ?? []
            arr.push(r)
            byMethod.set(r.method, arr)
        }
        const ambiguous: string[] = []
        for (const arr of byMethod.values()) {
            for (let i = 0; i < arr.length; i++) {
                for (let j = i + 1; j < arr.length; j++) {
                    if (arr[i].event === arr[j].event) continue
                    if (overlap(arr[i].path, arr[j].path) && nWild(arr[i].path) === nWild(arr[j].path)) {
                        ambiguous.push(`${arr[i].method} ${arr[i].path}(${arr[i].event}) <> ${arr[j].path}(${arr[j].event})`)
                    }
                }
            }
        }
        expect(ambiguous, ambiguous.join('\n')).toEqual([])
    })

    it('每条真实规则都能被自身 path 的具体化实例命中(通配段代入具体值)', () => {
        const idx = buildFetchIndex(FETCH_RULES)
        for (const r of FETCH_RULES) {
            // 抑制哨兵规则命中即返回 undefined(设计如此),不参与「必有命中」断言。
            if (r.event === FETCH_IGNORE) continue
            const concrete = r.path
                .split('/')
                .map((s) => (s.startsWith(':') ? '12345' : s))
                .join('/')
            // 命中的事件不一定是 r.event(可能有更具体的字面规则夺走),但必须有命中。
            expect(matchFetchEvent(idx, r.method, concrete), `${r.method} ${r.path}`).toBeTruthy()
        }
    })
})

describe('FETCH_RULES — 「请求成功 ≠ 用户动作」的语义边界(负例)', () => {
    // dap350 review 反馈:凡「2xx 不能无歧义证明该事件」的 path→event 一律移出本表,改由 UI/命令式采集。
    // 这些负例把「后台轮询 / 页面初始化加载 / 列表加载 / 详情轮询」钉死为**不产出**对应事件,
    // 防止回归重新把这些语义错误的映射加回来。
    const idx = buildFetchIndex(FETCH_RULES)

    it('后台版本轮询 GET /version.json 不产出任何事件(定时轮询,非用户打开设置)', () => {
        expect(matchFetchEvent(idx, 'GET', '/version.json')).toBeUndefined()
    })

    it('智能总结模板/候选加载不被当成用户意图(页面 init 与列表加载,非点击/勾选)', () => {
        // 新建页 init 加载模板 ≠ 点「新建」
        expect(matchFetchEvent(idx, 'GET', '/summary/api/v1/summary-templates')).toBeUndefined()
        // 候选列表加载 ≠ 用户勾选 channel / participant
        expect(matchFetchEvent(idx, 'GET', '/summary/api/v1/summary-chat-candidates')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/summary/api/v1/summary-member-candidates')).toBeUndefined()
    })

    it('总结详情 GET /summaries/:id 不产出 completed(失败/进行中/导航都会 2xx,completed 是状态沿)', () => {
        expect(matchFetchEvent(idx, 'GET', '/summary/api/v1/summaries/98765')).toBeUndefined()
    })

    it('市场 mine 列表 / tag 列表加载不被当成切视图 / 选标签(也用于建议/初始化)', () => {
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/mcps/mine')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/skills/mine')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/mcp_tags')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/skills/tags')).toBeUndefined()
    })

    it('这些「UI 采集专属」事件名不得再出现在 path 通道规则表里', () => {
        const uiOnly = new Set([
            'settings_menu_opened',
            'smart_summary_create_clicked',
            'smart_summary_scope_channel_selected',
            'smart_summary_scope_participant_selected',
            'smart_summary_completed',
            'market_view_switched',
            'market_tag_filtered',
            // ↓ dap350 二审移出 path 通道、改命令式/UI 采集的事件(见 review P1-1/P1-3/P1-4/P1-5/P2-3/P2-4/P2-7、§4)
            'app_launched',                        // Dap.setEnabled 首启一次性(GET /appconfig 会被可见性刷新反复调)
            'space_switched',                      // Pages/Main.applySpaceSelection(POST /conversation/sync 是 SDK 同步回调)
            'channel_subchannel_panel_opened',     // ThreadList.componentDidMount(GET /groups/:id/threads 刷新时会再拉)
            'contacts_module_entered',             // 导航回调按 menu id(GET /robot/my_bots 别处也调)
            'contact_opened',                      // Contacts.handleContactClick(GET /users/:id 是通用 profile 拉取)
            'smart_summary_agent_message_sent',    // AgentChatPanel.handleSend(覆盖点击+Enter;SSE 回退会二次计)
            'smart_summary_started',               // ↓ summary 走业务码信封,改 summaryApi 层 code===0 gate 后命令式
            'smart_summary_edited',
            'smart_summary_regenerated',
            'smart_summary_deleted',
            'smart_summary_timer_configured',
            'smart_summary_custom_template_created',
            'input_emoji_picker_opened',           // ↓ toggle 控件,改「打开/展开/切换」分支命令式(避免开+关翻倍)
            'input_expanded',
            'channel_search_filter_panel_opened',
            'market_tab_switched',
            'market_category_filtered',
            // ↓ dap350 三审(R2)再移出 path 通道、改命令式/UI 采集的事件(见 R2-B/C/D/E)
            'settings_voice_opened',               // VoiceSettingsPanel 挂载(GET /voice/local-config 被设置页焦点刷新连带调)
            'channel_search_tab_switched',         // ChannelSearchPanel onTabChange(POST _search_media|_search_files 每次搜索都打)
            'group_qrcode_viewed',                 // 二维码入口点击(GET /groups/:id/qrcode 组件挂载/刷新/重试重复打)
            'group_md_viewed',                     // 群设置面板随行拉取,编辑回读也重打 → 删除
            'group_webhook_panel_opened',          // 增删/重置 webhook 后回读刷新列表会重打 → 删除
            'market_card_opened',                  // 卡片打开走卡根 data-track(DOM 委托,亦覆盖键盘);六审 C2 删除了并存的命令式 market_card_viewed(同一次打开双计)
            'message_revoked',                     // 命令式单通道(撤回入口调 trackMessageRevoked;fetch 规则会双计,见四审 P1-1)
        ])
        const leaked = FETCH_RULES.filter((r) => uiOnly.has(r.event)).map((r) => `${r.method} ${r.path} → ${r.event}`)
        expect(leaked, leaked.join('\n')).toEqual([])
    })

    it('POST /message/revoke 不产出 message_revoked(改命令式单通道,fetch+命令式会双计;见四审 P1-1)', () => {
        expect(matchFetchEvent(idx, 'POST', '/api/v1/message/revoke')).toBeUndefined()
    })

    it('市场详情 GET /:id 不再产出 market_card_viewed(改 DOM 采集,fetch 层区分不了看/编;见二审 P2-1)', () => {
        // /:id 钉成 IGNORE:点卡片看详情已改卡根 data-track="market_card_opened"(DOM 委托);编辑(⋯→fetchDetail)
        // 也拉同一 GET,不能在 fetch 层计成查看。versions 子资源不受影响(段数不同,语义仍成立)。
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/mcps/42')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/skills/42')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/market/api/v1/skills/42/versions')).toBe('market_skill_version_history_viewed')
    })
})

describe('FETCH_RULES — 二审(dap350)移出通道的端点钉死为「不产出」(防回归)', () => {
    // 这些端点的 2xx 会被轮询/可见性刷新/SDK 回调/别处复用/信封失败等触发,「成功 ≠ 用户动作(且成功)」,
    // 已分别改为命令式或 UI 采集(见对应 review 项)。下面把它们钉死为在 path 通道无命中。
    const idx = buildFetchIndex(FETCH_RULES)

    it('GET /common/appconfig 不产出 app_launched(前台可见性/focus 会反复刷)', () => {
        expect(matchFetchEvent(idx, 'GET', '/api/v1/common/appconfig')).toBeUndefined()
    })

    it('POST /conversation/sync 不产出 space_switched(WuKongIM 会话同步回调,连接/重连都触发)', () => {
        expect(matchFetchEvent(idx, 'POST', '/api/v1/conversation/sync')).toBeUndefined()
    })

    it('GET /groups/:id/threads 不产出 channel_subchannel_panel_opened(删除/归档/重试会再拉)', () => {
        expect(matchFetchEvent(idx, 'GET', '/api/v1/groups/98765/threads')).toBeUndefined()
    })

    it('GET /robot/my_bots 不产出 contacts_module_entered(BotStore/PersonaSettings 也调)', () => {
        expect(matchFetchEvent(idx, 'GET', '/api/v1/robot/my_bots')).toBeUndefined()
    })

    it('GET /users/:id 不产出 contact_opened(通用 profile 拉取,bot/内部查库都打)', () => {
        expect(matchFetchEvent(idx, 'GET', '/api/v1/users/12345')).toBeUndefined()
    })

    it('summary 成功类 mutation 端点不产出 smart_summary_*(走业务码信封,改 api 层 code===0 gate)', () => {
        // 代表性端点:创建/删除/重生成 —— 这些 2xx 可能携带 code≠0 的逻辑失败,不能进 2xx 通道。
        expect(matchFetchEvent(idx, 'POST', '/summary/api/v1/summaries')).toBeUndefined()
        expect(matchFetchEvent(idx, 'DELETE', '/summary/api/v1/summaries/42')).toBeUndefined()
        expect(matchFetchEvent(idx, 'POST', '/summary/api/v1/summaries/42/regenerate')).toBeUndefined()
    })

    it('POST /messages/_search_media|_search_files 不产出 channel_search_tab_switched(每次搜索/去抖/翻页都打)', () => {
        // R2-D:改由 ChannelSearchPanel onTabChange 命令式,只在 tab 真正切换时计一次。
        expect(matchFetchEvent(idx, 'POST', '/api/v1/messages/_search_media')).toBeUndefined()
        expect(matchFetchEvent(idx, 'POST', '/api/v1/messages/_search_files')).toBeUndefined()
    })

    it('GET /voice/local-config 不产出 settings_voice_opened(设置页焦点刷新会连带调)', () => {
        // R2-C:改由 VoiceSettingsPanel 挂载命令式。PUT 仍保留 settings_voice_toggled(真实写=切换)。
        expect(matchFetchEvent(idx, 'GET', '/api/v1/voice/local-config')).toBeUndefined()
        expect(matchFetchEvent(idx, 'PUT', '/api/v1/voice/local-config')).toBe('settings_voice_toggled')
    })

    it('GET /groups/:id/qrcode|md|incoming-webhooks 不产出 view/open 事件(组件挂载/回读刷新重复打)', () => {
        // R2-E:三条 config-row GET 删除。相邻的写类端点仍保留(真实写=动作)。
        expect(matchFetchEvent(idx, 'GET', '/api/v1/groups/98765/qrcode')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/api/v1/groups/98765/md')).toBeUndefined()
        expect(matchFetchEvent(idx, 'GET', '/api/v1/groups/98765/incoming-webhooks')).toBeUndefined()
        expect(matchFetchEvent(idx, 'PUT', '/api/v1/groups/98765/md')).toBe('group_md_edited')
        expect(matchFetchEvent(idx, 'POST', '/api/v1/groups/98765/incoming-webhooks')).toBe('webhook_created')
    })
})

describe('FETCH_RULES — 子区(thread)作用域 webhook 与群级同事件(十审 🔴)', () => {
    // IncomingWebhookService 在 threadShortId 存在时把 create/regenerate/test/delete 切到
    // groups/:g/threads/:t/incoming-webhooks/... 嵌套路径;ChannelWebhook UI 群/子区共用同一套操作。
    // matchFetchEvent 严格按段数匹配,群级规则永不命中子区路径,故须有平行 thread 规则,否则子区动作漏计。
    const idx = buildFetchIndex(FETCH_RULES)

    it('thread-nested create/regenerate/test/delete 命中与群级相同的 webhook_* 事件', () => {
        expect(
            matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/threads/t1/incoming-webhooks')
        ).toBe('webhook_created')
        expect(
            matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/threads/t1/incoming-webhooks/w1/regenerate')
        ).toBe('webhook_url_reset')
        expect(
            matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/threads/t1/incoming-webhooks/w1/test')
        ).toBe('webhook_tested')
        expect(
            matchFetchEvent(idx, 'DELETE', '/api/v1/groups/g1/threads/t1/incoming-webhooks/w1')
        ).toBe('webhook_deleted')
    })

    it('群级路径仍各自命中原事件(平行 thread 规则不干扰群级)', () => {
        expect(matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/incoming-webhooks')).toBe('webhook_created')
        expect(
            matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/incoming-webhooks/w1/regenerate')
        ).toBe('webhook_url_reset')
        expect(matchFetchEvent(idx, 'POST', '/api/v1/groups/g1/incoming-webhooks/w1/test')).toBe('webhook_tested')
        expect(matchFetchEvent(idx, 'DELETE', '/api/v1/groups/g1/incoming-webhooks/w1')).toBe('webhook_deleted')
    })

    it('子区 md 编辑(GroupMdEditor 同一保存流)与群级同发 group_md_edited', () => {
        // PUT groups/:g/threads/:t/md(updateThreadMd)与群级 PUT groups/:id/md 是同一「保存」动作。
        expect(matchFetchEvent(idx, 'PUT', '/api/v1/groups/g1/threads/t1/md')).toBe('group_md_edited')
        expect(matchFetchEvent(idx, 'PUT', '/api/v1/groups/g1/md')).toBe('group_md_edited')
    })
})

describe('FETCH_RULES — conversation_left 已移出 path 通道(十一审 🔴,防回归)', () => {
    // 原 POST /groups/:id/exit 与 DELETE /conversations/:id/:id 两条 fetch 规则:退群一次手势双发、
    // 把「关闭会话」(onCloseChat 同走 DELETE conversations)误计成退出、子区/DM 退出靠兜底 DELETE 偶发命中。
    // 已改命令式(exitChannelSettingGroup / leaveChannelSettingThread 成功后单发)。这里钉死两端点无 path 映射。
    const idx = buildFetchIndex(FETCH_RULES)

    it('POST /groups/:id/exit 不产出 conversation_left(退群改命令式,fetch 会与 deleteConversation 双计)', () => {
        expect(matchFetchEvent(idx, 'POST', '/api/v1/groups/98765/exit')).toBeUndefined()
    })

    it('DELETE /conversations/:id/:id 不产出 conversation_left(「关闭会话」同走此端点,非退出)', () => {
        expect(matchFetchEvent(idx, 'DELETE', '/api/v1/conversations/1/2')).toBeUndefined()
    })

    it('conversation_left 不再出现在 FETCH_RULES 任一条(整表扫描)', () => {
        const leaked = FETCH_RULES.filter((r) => r.event === 'conversation_left').map((r) => `${r.method} ${r.path}`)
        expect(leaked, leaked.join('\n')).toEqual([])
    })
})
