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
