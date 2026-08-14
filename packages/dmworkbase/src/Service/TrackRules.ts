/**
 * TrackRules —— 埋点蒙版的「锚点规则表」(Dap fallback 支路的数据 + 索引)
 * =====================================================================
 * 背景:蒙版原路径靠业务组件挂 `data-track` 声明式采集(见 Dap.installClickDelegation)。
 * 但全站约 165 个「无网络的 UI 意图」动作当前没埋,逐个加 `data-track` 成本高。本表提供一条
 * **纯前端 fallback**:在 `closest('[data-track]')` 落空后,拿被点元素身上**现成的
 * `data-testid`** 去查这张打包进 bundle 的静态表,命中就用规则里的 `event` 走现有 track()。
 *
 * 硬约束(与 Dap 一致,见 Dap.ts §2 / installClickDelegation):
 *   - `data-track` 绝对优先:有 `data-track` 就走原路径,本表只吃「没有 data-track」的节点
 *     → 现有埋点 / 破例点零回归。
 *   - 隐私:规则只携带**静态枚举** props;运行时 props 仍复用 collectDatasetProps 读 data-*
 *     (如 data-object-id),**绝不读控件 value / innerText / 正文**。
 *   - 事件名必须**先在服务端采集器注册**,否则前端照发、服务端静默死信丢弃(前端不报错)。
 *   - 主路径 O(1):有 `testid` 的规则进 `byTestid` Map;无 `testid` 的 role/aria 规则进 `loose`
 *     线性兜底(数量应保持很小)。
 */

/** 规则携带的静态 props 只允许基础量,和 TrackEnvelope.props 的 TrackPrimitive 对齐。 */
type RulePrimitive = string | number | boolean | null

/**
 * 单条锚点规则。`event` 必填;其余为**命中约束**(全部 AND):
 *   - `testid`        主键:被 walk 到的祖先元素的 `data-testid` 精确等于它 → 进 byTestid 索引。
 *   - `role`          约束该元素的 `role` 属性(byTestid 规则的附加约束 / loose 规则的主键)。
 *   - `route`         仅当 `location.pathname` 命中(精确或前缀 + 段边界)时生效;string | string[]。
 *   - `closestTestid` 该元素需能 `closest([data-testid=closestTestid])`(用于同名 testid 消歧)。
 *   - `on`            仅在该交互类型触发('click' | 'submit' | 'keydown');缺省则三类都可。
 *   - `props`         合并进上报的**静态枚举**(如 { area: 'automation', action: 'run' });
 *                     运行时再叠加 collectDatasetProps(el) 读的 data-*(data-object-id 等)。
 */
export interface TrackRule {
    event: string
    testid?: string
    role?: string
    route?: string | string[]
    closestTestid?: string
    on?: 'click' | 'submit' | 'keydown'
    props?: Record<string, RulePrimitive>
}

/** buildIndex 产物:testid 主索引 + 无 testid 的 loose 线性表。 */
export interface TrackRuleIndex {
    byTestid: Map<string, TrackRule[]>
    loose: TrackRule[]
}

/**
 * 建索引:有 `testid` 的按 testid 分桶进 Map(同一 testid 可挂多条,靠 route/closestTestid/on
 * 消歧);无 `testid` 的进 loose(须带 role,否则会匹配一切)。O(n) 构建,查询主路径 O(1)。
 */
export function buildIndex(rules: TrackRule[]): TrackRuleIndex {
    const byTestid = new Map<string, TrackRule[]>()
    const loose: TrackRule[] = []
    for (const rule of rules) {
        if (!rule || !rule.event) continue
        if (rule.testid) {
            const arr = byTestid.get(rule.testid)
            if (arr) arr.push(rule)
            else byTestid.set(rule.testid, [rule])
        } else {
            loose.push(rule)
        }
    }
    return { byTestid, loose }
}

/**
 * route 约束匹配:规则的 `route` 缺省 → 恒真;否则要求 `current` 精确等于某项,或以「该项 + 段
 * 边界(`/`)」为前缀。段边界避免 `/automation` 误配 `/automationX`。
 */
export function matchRoute(route: TrackRule['route'], current: string): boolean {
    if (!route) return true
    const list = Array.isArray(route) ? route : [route]
    return list.some((r) => current === r || current.startsWith(r.endsWith('/') ? r : r + '/'))
}

/**
 * 全站锚点规则表(打包进 bundle)。**按对账 sheet(d_e8d2c5702b3b58abb5f85777)分模块逐条填**,
 * 事件名须以 sheet 为准且已在服务端采集器注册。首个切片:automation 模块(见任务)。
 *
 * 示例(结构参考,勿直接启用未注册的事件名):
 *   { event: 'automation_run_clicked', testid: 'automation-run-btn', route: '/automation',
 *     props: { area: 'automation', action: 'run' } },
 *   { event: 'automation_toggle_switched', role: 'switch', route: '/automation',
 *     closestTestid: 'automation-rule-row' },   // loose:靠 role 命中,无独立 testid
 */
export const TRACK_RULES: TrackRule[] = [
    // 待填:按对账 sheet(d_e8d2c5702b3b58abb5f85777)分模块逐条填,事件名以 sheet 为准 + 确认服务端已注册。
    // 说明:config 驱动面(ChannelSetting/UserInfo 等走 <Sections> 的)改用 Row.trackEvent 覆盖,不走本表;
    // 本表只吃 imperative JSX 面里「有现成 data-testid / role 可锚、且未挂 data-track」的节点。
]
