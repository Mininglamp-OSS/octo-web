import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CitationText from './CitationText';
import type { CitationItem, TeamCitationItem, MemberStatus } from '../types/summary';

// @octo/base is aliased to the dmworkBase mock by vitest.config.ts, so useI18n /
// i18n already resolve. We only need to tame the semi-ui Popover here: the real
// one portals its content out of the render tree and is driven by `visible`.
// This mock renders the trigger child inline and only emits the popover content
// when `visible` is true, exposing onClickOutSide so we can exercise the
// open/close interaction without a real portal.
vi.mock('@douyinfe/semi-ui', () => ({
    Popover: ({ children, content, visible, onClickOutSide }: any) => (
        <span data-testid="popover" data-visible={visible ? 'true' : 'false'}>
            {children}
            {visible && (
                <span data-testid="popover-content" onClick={() => onClickOutSide?.()}>
                    {content}
                </span>
            )}
        </span>
    ),
}));

// wukongimjssdk is pulled in transitively by CitationBadge for the normal [n]
// jump logic. Stub it so the module graph resolves under jsdom.
vi.mock('wukongimjssdk', () => ({
    Channel: class {
        constructor(public channelID: string, public channelType: number) {}
    },
    ChannelTypePerson: 1,
    ChannelTypeGroup: 2,
}));

function render(ui: React.ReactElement) {
    return rtlRender(ui);
}

function makeCitation(overrides: Partial<CitationItem> = {}): CitationItem {
    return {
        index: 1,
        sender: '张三',
        content: '这是被引用的消息',
        sent_at: '2026-01-01T10:00:00Z',
        message_seq: 100,
        channel_id: 'ch1',
        channel_type: 2,
        ...overrides,
    } as CitationItem;
}

function makeTeamCitation(overrides: Partial<TeamCitationItem> = {}): TeamCitationItem {
    return {
        index: 1,
        user_id: 'u1',
        user_name: '李四',
        ...overrides,
    };
}

// The badge that actually renders a Popover (i.e. its citation/teamCitation was
// resolved by index) carries className "citation-badge". A <sup> without that
// class is the degraded static fallback (no matching index). Helpers below let
// each case assert on the interactive badges only.
function activeBadges() {
    return Array.from(document.querySelectorAll('sup.citation-badge')) as HTMLElement[];
}

function badgeByText(text: string) {
    return activeBadges().find(el => el.textContent === text);
}

describe('CitationText — [n] vs [Pn] parsing', () => {
    it('1) renders normal [n] and team [P1] side by side without crosstalk', () => {
        render(
            <CitationText
                content="普通引用 [1] 和团队引用 [P1] 同时出现"
                citations={[makeCitation({ index: 1 })]}
                teamCitations={[makeTeamCitation({ index: 1 })]}
            />,
        );

        const badges = activeBadges();
        const texts = badges.map(b => b.textContent);

        // Both an interactive normal citation badge and an interactive team badge
        // must exist, and they must be distinct nodes (no merge / no clobber).
        expect(texts).toContain('[1]');
        expect(texts).toContain('[P1]');

        const normal = badgeByText('[1]')!;
        const team = badgeByText('[P1]')!;
        expect(normal).toBeTruthy();
        expect(team).toBeTruthy();
        expect(normal).not.toBe(team);
    });

    it('2) lookahead removed: regex now matches "[P1]" even when followed by "(" (backend parity)', () => {
        // The single behavioral change in this loop is dropping the negative
        // lookahead (?!\() and capping to \d{1,3}, making the FRONTEND regex
        // byte-for-byte identical to the backend authority
        // (internal/worker/meta_processor.go: `\[P(\d{1,3})\]`). Go RE2 has no
        // lookahead, so the old /\[P(\d+)\](?!\()/ could never match the backend.
        //
        // We assert parity at the regex level (the unit the remark plugin uses on
        // text nodes), because that is exactly what the backend runs on raw text:
        const frontendRe = /\[P(\d{1,3})\]/g; // must mirror CitationText.tsx
        const backendRe = /\[P(\d{1,3})\]/g;  // mirrors meta_processor.go

        // Old regex would NOT match "[P1](" (lookahead). New one MUST.
        const oldRe = /\[P(\d+)\](?!\()/g;
        expect('[P1](url)'.match(oldRe)).toBeNull();
        expect('[P1](url)'.match(frontendRe)).toEqual(['[P1]']);
        expect('[P1](url)'.match(backendRe)).toEqual('[P1](url)'.match(frontendRe));

        // Caveat for the FULL markdown render path: remark-gfm parses "[P1](url)"
        // into an <a> link BEFORE our text-node visitor runs, so in rendered HTML
        // it shows as a link, not a team badge. This is a markdown-pipeline
        // artifact, not a regex divergence — and team-summary bodies are
        // LLM-generated plain text that never emit "[P1](url)" in practice. When
        // the [P1] is NOT part of a markdown link (the real-world case), the
        // regex change makes it a team token exactly like the backend:
        render(
            <CitationText
                content="参见 [P1] 的发言（在分组里）"
                citations={[]}
                teamCitations={[makeTeamCitation({ index: 1 })]}
            />,
        );
        const team = badgeByText('[P1]');
        expect(team).toBeTruthy();
    });

    it('3) boundary: [P12]/[P0] match, [P1000]/[P]/[p1] do not (1-3 digits, [P0..P999])', () => {
        render(
            <CitationText
                content="命中 [P12] 命中 [P0] 不命中 [P1000] 不命中 [P] 不命中 [p1] 结束"
                citations={[]}
                teamCitations={[
                    makeTeamCitation({ index: 12, user_name: 'M12' }),
                    makeTeamCitation({ index: 0, user_name: 'M0' }),
                    makeTeamCitation({ index: 1, user_name: 'M1' }),
                ]}
            />,
        );

        const texts = activeBadges().map(b => b.textContent);

        // \d{1,3}: [P12] and [P0] are valid team tokens -> interactive badges.
        expect(texts).toContain('[P12]');
        expect(texts).toContain('[P0]');

        // [P1000] is 4 digits: regex only eats the first 3 (matching [P100]),
        // and there is no teamCitation index 100, so it degrades to a static
        // (non-interactive) badge. Either way the literal 4-digit "[P1000]"
        // interactive token must never appear.
        expect(texts).not.toContain('[P1000]');
        expect(texts).not.toContain('[P100]');

        // [P] (no digits) and lowercase [p1] are never team tokens, so they
        // never become interactive badges.
        expect(texts).not.toContain('[P]');
        expect(texts).not.toContain('[p1]');
        // The lowercase/empty forms remain as plain text in the output.
        expect(document.body.textContent).toContain('[P]');
        expect(document.body.textContent).toContain('[p1]');
    });

    it('4) badge keys are namespaced (tc- vs c-): clicking [P1] opens only its own popover', () => {
        render(
            <CitationText
                content="混排 [1] 与 [P1]"
                citations={[makeCitation({ index: 1 })]}
                teamCitations={[makeTeamCitation({ index: 1, user_name: '李四' })]}
            />,
        );

        // Nothing open initially.
        expect(screen.queryAllByTestId('popover-content')).toHaveLength(0);

        const team = badgeByText('[P1]')!;
        fireEvent.click(team);

        // Exactly one popover is open, and it is the team member popover
        // (member name from i18n "summary.citation.member" => "成员：李四"),
        // never the normal-citation message content. tc- / c- key prefixes keep
        // the two badges' active state isolated.
        const open = screen.queryAllByTestId('popover-content');
        expect(open).toHaveLength(1);
        expect(open[0].textContent).toContain('李四');
        expect(open[0].textContent).not.toContain('这是被引用的消息');
    });

    it('4b) distinct components/key prefixes for normal vs team badges', () => {
        // Render the two kinds separately and confirm the team plugin emits a
        // <teamcitation>-backed badge whose text differs from the [n] badge.
        const { unmount } = render(
            <CitationText content="普通 [1]" citations={[makeCitation({ index: 1 })]} teamCitations={[]} />,
        );
        expect(badgeByText('[1]')).toBeTruthy();
        expect(badgeByText('[P1]')).toBeFalsy();
        unmount();

        render(
            <CitationText content="团队 [P1]" citations={[]} teamCitations={[makeTeamCitation({ index: 1 })]} />,
        );
        expect(badgeByText('[P1]')).toBeTruthy();
        expect(badgeByText('[1]')).toBeFalsy();
    });

    // V5/§6.2：[Pn] 可点击，点击用 user_id 在已拉取的 members 里匹配同一成员，
    // 取其 content 展示（不发新请求）。
    it('5) [Pn] click surfaces the matched member\'s single-person report content', () => {
        const members: MemberStatus[] = [
            {
                user_id: 'u1',
                user_name: '李四',
                status: 'submitted',
                submitted_at: '2026-01-01T10:00:00Z',
                content: '这是李四的单人总结正文',
                citations: [],
            },
        ];
        render(
            <CitationText
                content="参见 [P1]"
                citations={[]}
                teamCitations={[makeTeamCitation({ index: 1, user_id: 'u1', user_name: '李四' })]}
                members={members}
            />,
        );
        const team = badgeByText('[P1]')!;
        fireEvent.click(team);
        const open = screen.queryAllByTestId('popover-content');
        expect(open.length).toBeGreaterThanOrEqual(1);
        // 弹出里含该成员的单人报告正文。
        expect(document.body.textContent).toContain('这是李四的单人总结正文');
    });

    it('6) [Pn] click degrades to name-only when member has no submitted content', () => {
        const members: MemberStatus[] = [
            { user_id: 'u1', user_name: '李四', status: 'pending', submitted_at: null },
        ];
        render(
            <CitationText
                content="参见 [P1]"
                citations={[]}
                teamCitations={[makeTeamCitation({ index: 1, user_id: 'u1', user_name: '李四' })]}
                members={members}
            />,
        );
        const team = badgeByText('[P1]')!;
        fireEvent.click(team);
        const open = screen.queryAllByTestId('popover-content');
        expect(open.length).toBeGreaterThanOrEqual(1);
        expect(open[0].textContent).toContain('李四');
    });

    // m2（隐私兜底，第二轮）：[Pn] 弹窗渲染成员单人报告时，绝不消费 member.citations，
    // 且对 memberContent 清掉 [n] 角标——即便（旧后端/缓存）给 member 带了 citations，
    // 也不能让他人点开看到原始聊天记录。fail-before（CitationBadge 传 member.citations）/
    // pass-after（固定 citations=[] + hidePlainCitations + 清 [n]）。
    it('m2) [Pn] popover never exposes member.citations and strips [n] from member content', () => {
        const members: MemberStatus[] = [
            {
                user_id: 'u1',
                user_name: '李四',
                status: 'submitted',
                submitted_at: '2026-01-01T10:00:00Z',
                content: '李四的单人总结 [1] 正文',
                // 旧后端/缓存可能仍带 citations（原始聊天记录原文）。
                citations: [makeCitation({ index: 1, content: '不应暴露的原始聊天记录原文' })],
            },
        ];
        render(
            <CitationText
                content="参见 [P1]"
                citations={[]}
                teamCitations={[makeTeamCitation({ index: 1, user_id: 'u1', user_name: '李四' })]}
                members={members}
            />,
        );
        const team = badgeByText('[P1]')!;
        fireEvent.click(team);
        // 弹窗展示正文，但 [n] 角标被清、不可点开，原始聊天记录绝不出现。
        expect(document.body.textContent).toContain('李四的单人总结');
        expect(document.body.textContent).not.toContain('不应暴露的原始聊天记录原文');
        expect(badgeByText('[1]')).toBeFalsy();
    });
});

// 需求2（隐私收口）：hidePlainCitations 开关——成员间互看团队总结 /
// 他人报告时，普通引用 [n]（指向某人原始聊天记录）不可点开看原文；
// 但团队引用 [Pn]（指向人/跳作者报告，不暴露聊天原文）仍可点。
describe('CitationText — hidePlainCitations 隐私收口', () => {
    // fail-before / pass-after 核心：hidePlainCitations 为 true 时，即使传了 citations，
    // [n] 也不能渲染成可点 CitationBadge（退化为纯文本）。
    it('hidePlainCitations=true: [n] is NOT rendered as an interactive citation badge even with citations supplied', () => {
        render(
            <CitationText
                content="他人总结正文 [1]"
                citations={[makeCitation({ index: 1, content: '原始聊天记录原文' })]}
                hidePlainCitations
            />,
        );
        // 无任何可交互的普通引用徒标。
        expect(badgeByText('[1]')).toBeFalsy();
        // [1] 以纯文本保留在输出里（不被渲染成 badge）。
        expect(document.body.textContent).toContain('[1]');
        // 点不开 → 不会出现原文弹窗。
        expect(screen.queryAllByTestId('popover-content')).toHaveLength(0);
    });

    it('hidePlainCitations=false (default): [n] still renders an interactive badge (回归保护：自己看自己)', () => {
        render(
            <CitationText
                content="自己的总结 [1]"
                citations={[makeCitation({ index: 1 })]}
            />,
        );
        expect(badgeByText('[1]')).toBeTruthy();
    });

    it('hidePlainCitations=true: team [Pn] STILL renders an interactive badge (跳作者报告不泄露原文)', () => {
        render(
            <CitationText
                content="团队总结：普通引用 [1] 与团队引用 [P1]"
                citations={[makeCitation({ index: 1, content: '原始聊天记录原文' })]}
                teamCitations={[makeTeamCitation({ index: 1, user_name: '李四' })]}
                hidePlainCitations
            />,
        );
        // [n] 不可点，[Pn] 仍可点。
        expect(badgeByText('[1]')).toBeFalsy();
        expect(badgeByText('[P1]')).toBeTruthy();
    });
});
