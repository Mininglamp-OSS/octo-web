import { describe, it, expect } from 'vitest'
import { TRACK_RULES, buildIndex } from '../TrackRules'

/**
 * 静态锚点规则表（TRACK_RULES）内容断言 —— 守 A_rule 首批 6 条 summary 规则。
 * 事件名以整合表 d_2c47796780d4efdd3c5aa8b3 为准；testid 为 dmworksummary summaryTestIds.* 的现成锚点。
 * 这些是纯数据，容易在后续分批填表时被误删/改名，故单独断言其存在与形状。
 */
describe('TRACK_RULES — A_rule summary batch', () => {
    const expected: Array<{ event: string; testid: string }> = [
        { event: 'channel_summary_panel_opened', testid: 'summary-chat-panel-header-btn' },
        { event: 'smart_summary_edit_opened', testid: 'summary-detail-edit-btn' },
        { event: 'smart_summary_regenerate_dialog_opened', testid: 'summary-detail-regenerate-btn' },
        { event: 'smart_summary_delete_dialog_opened', testid: 'summary-detail-delete-btn' },
        // smart_summary_agent_message_sent 已移出本表 —— 点击规则漏 Enter 发送(焦点在 textarea),
        // 改为 AgentChatPanel.handleSend 命令式 track(覆盖点击+Enter),见 review P1-4。
        { event: 'smart_summary_agent_new_session', testid: 'summary-agent-new-session-btn' },
    ]

    it.each(expected)('has a click rule $event → $testid', ({ event, testid }) => {
        const rule = TRACK_RULES.find((r) => r.event === event)
        expect(rule, `missing rule for ${event}`).toBeTruthy()
        expect(rule?.testid).toBe(testid)
        expect(rule?.on).toBe('click')
    })

    it('every A_rule testid is indexed under byTestid (O(1) main path, none leak to loose)', () => {
        const idx = buildIndex(TRACK_RULES)
        for (const { testid } of expected) {
            expect(idx.byTestid.has(testid)).toBe(true)
        }
        // 本批全部带 testid，不应有 role-only 规则落进 loose 线性表。
        expect(idx.loose.every((r) => !expected.some((e) => e.event === r.event))).toBe(true)
    })
})

describe('TRACK_RULES — *_searched keeps the on:\'click\' activation gate (R13 B3 pin)', () => {
    // 剥掉 on:'click' 的突变在本套件曾全绿存活(Service 751/751)——keydown/submit 一旦放行,
    // 每次键入都会被计成「搜索」,事件从「激活」漂移成「逐字符」。此钉让 strip 突变立即变红:
    // 两条 *_searched 规则必须钉死在「点击激活」语义(DAP_EVENTS.md 对应行已写明该行为)。
    const cases = [
        { event: 'project_searched', testid: 'project-search-input' },
        { event: 'expert_searched', testid: 'loop-agent-search-input' },
    ]
    it.each(cases)('$event keeps the on:click activation gate', ({ event, testid }) => {
        const rule = TRACK_RULES.find((r) => r.event === event)
        expect(rule, `missing rule for ${event}`).toBeTruthy()
        expect(rule?.testid).toBe(testid)
        expect(rule?.on, `${event} must stay on:'click' (box activation, never per-keystroke)`).toBe('click')
    })
})

describe('TRACK_RULES — dap350 docs events moved to the octo-docs-module command side (防回归)', () => {
    // document_tab_switched / document_forward_panel_opened left this declarative table and are now
    // emitted command-side by octo-docs-module (DocsTabs tab click; each doc view's forward button),
    // carrying full props. channelUniqueness.test.ts already treats them as "imperative sites", but it
    // only does so because the migration COMMENTS in TrackRules.ts contain literal Dap.track(...) text
    // the scanner regex matches inside comments — reword a comment and that guard silently dies
    // (review A-1). These are explicit, comment-independent negative pins: assert both event names and
    // all three source testids are absent from TRACK_RULES, so re-adding either rule here goes red.
    const movedEvents = ['document_tab_switched', 'document_forward_panel_opened']
    const movedTestids = ['docs-tab-recent', 'docs-tab-mine', 'doc-forward-btn']

    it.each(movedEvents)('%s has no declarative TRACK_RULES rule (emitted command-side now)', (event) => {
        const leaked = TRACK_RULES.filter((r) => r.event === event).map((r) => r.testid ?? '(no testid)')
        expect(leaked, `${event} must not re-enter TRACK_RULES: ${leaked.join(', ')}`).toEqual([])
    })

    it.each(movedTestids)('testid %s is not wired to any TRACK_RULES rule', (testid) => {
        const leaked = TRACK_RULES.filter((r) => r.testid === testid).map((r) => r.event)
        expect(leaked, `${testid} must not re-enter TRACK_RULES: ${leaked.join(', ')}`).toEqual([])
    })
})

describe('TRACK_RULES — unified marketplace publish funnel', () => {
    it('tracks the single publish entry', () => {
        expect(TRACK_RULES).toContainEqual({
            event: 'market_publish_entry_clicked',
            testid: 'mine-publish-entry',
            on: 'click',
        })
    })

    it.each([
        ['mine-publish-skill-bot', 'skill', 'bot'],
        ['mine-publish-skill-manual', 'skill', 'manual'],
        ['mine-publish-connector-bot', 'mcp', 'bot'],
        ['mine-publish-connector-manual', 'mcp', 'manual'],
        ['mine-publish-expert-bot', 'expert', 'bot'],
        ['mine-publish-squad-bot', 'expert_team', 'bot'],
    ])('tracks %s with its asset type and method', (testid, marketType, method) => {
        expect(TRACK_RULES).toContainEqual({
            event: 'market_publish_method_selected',
            testid,
            on: 'click',
            props: { market_type: marketType, method },
        })
    })

    it('does not retain hidden legacy publish anchors', () => {
        const legacyTestIds = new Set([
            'mcp-publish-entry',
            'skill-publish-entry',
            'mcp-publish-method-bot',
            'mcp-publish-method-manual',
            'skill-publish-method-bot',
            'skill-publish-method-manual',
        ])
        expect(TRACK_RULES.some((rule) => legacyTestIds.has(rule.testid ?? ''))).toBe(false)
    })
})
