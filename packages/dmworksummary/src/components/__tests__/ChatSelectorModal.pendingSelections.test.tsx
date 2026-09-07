// RED commit for PR #1593 P1-1 (yujiawei review 5087124100, Jerry-Xin review
// 5087791710 blocker 1): while the members picker is open, any parent
// re-render that passes a NEW selectedMembers array reference (the Feature
// supplies scopeParticipantsToCandidates(...) inline — an unmemoized .map —
// so it is new on every render, including per-SSE-event and per-3s-poll)
// resets localSelectedMembers, silently reverting unconfirmed ticks.

import React from 'react';
import { render as rtlRender, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChatSelectorModal from '../ChatSelectorModal';
import WKApp from '@octo/base/src/App';

const mockGetRoster = vi.fn();

vi.mock('../../api/summaryApi', () => ({
    getChatCandidates: vi.fn(),
}));

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return actual;
});

vi.mock('@octo/base/src/Service/SidebarService', () => ({
    default: { sync: vi.fn() },
    SidebarTargetType: { DM: 1, CHANNEL: 2, THREAD: 5 },
}));

vi.mock('@octo/base/src/Service/SpaceService', () => ({
    SpaceService: { shared: { getRoster: (...args: any[]) => mockGetRoster(...args) } },
}));

vi.mock('@octo/base/src/Components/AiBadge', () => ({
    default: () => <span data-testid="ai-badge" />,
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => <span data-testid="icon-search" />,
}));

vi.mock('@douyinfe/semi-ui', () => ({
    Modal: ({ children, visible, footer }: any) =>
        visible ? (
            <div data-testid="summary-chat-selector-modal">
                <div data-testid="modal-body">{children}</div>
                <div data-testid="modal-footer">{footer}</div>
            </div>
        ) : null,
    Input: ({ value, onChange, placeholder }: any) => (
        <input data-testid="search-input" value={value} placeholder={placeholder} onChange={(e: any) => onChange(e.target.value)} />
    ),
    Checkbox: ({ checked, disabled, onChange }: any) => (
        <input type="checkbox" readOnly checked={!!checked} disabled={disabled} onChange={onChange} />
    ),
    Button: ({ children, onClick, disabled }: any) => (
        <button onClick={onClick} disabled={disabled}>{children}</button>
    ),
    Spin: () => <div data-testid="spinner">loading</div>,
    Empty: ({ description }: any) => <div data-testid="empty">{description}</div>,
    Tag: ({ children }: any) => <span data-testid="tag">{children}</span>,
}));

const baseProps = {
    onSelect: vi.fn(),
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
};

// 流式输出 / 3s 轮询 / candidates 解析都会触发 Feature 重渲染 — 每次传入
// scopeParticipantsToCandidates(...) 的新数组引用 (与已确认 scope 内容相同).
function rerenderWithSameContent(utils: ReturnType<typeof rtlRender>) {
    utils.rerender(
        <ChatSelectorModal
            {...baseProps}
            mode="members"
            channel={null}
            memberCandidates={[
                { uid: 'u1', name: '张三' },
                { uid: 'u2', name: '李四' },
            ]}
            selectedMembers={[]} // ← 新的 [] 引用: 引用变了, 内容没变
            visible
        />,
    );
}

describe('ChatSelectorModal — pending member selections survive parent re-renders (P1-1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        WKApp.shared.currentSpaceId = 'space-123';
        (WKApp as any).dataSource = undefined;
        mockGetRoster.mockResolvedValue([
            { uid: 'u1', name: '张三', robot: 0 },
            { uid: 'u2', name: '李四', robot: 0 },
        ]);
    });

    it('勾选后父组件重渲染 (selectedMembers 新引用同内容) 不重置未确认勾选', async () => {
        let utils: ReturnType<typeof rtlRender>;
        await act(async () => {
            utils = rtlRender(
                <ChatSelectorModal
                    {...baseProps}
                    mode="members"
                    channel={null}
                    memberCandidates={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    selectedMembers={[]}
                    visible={false}
                />,
                { legacyRoot: true },
            );
        });
        await act(async () => {
            utils!.rerender(
                <ChatSelectorModal
                    {...baseProps}
                    mode="members"
                    channel={null}
                    memberCandidates={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    selectedMembers={[]}
                    visible
                />,
            );
        });

        // 用户勾选张三 (写入 localSelectedMembers, 尚未确认). 成员行可能多处
        // 渲染 (确认区 + 列表), 取列表行内 checkbox.
        const zhangRow = utils!.getAllByText('张三').map((el) => el.closest('.chat-selector-item')).find(Boolean)!;
        fireEvent.click(zhangRow);
        expect(zhangRow.querySelector('input')!.checked).toBe(true);

        // 模拟流式输出 / 轮询导致的父组件重渲染: selectedMembers 引用变化但内容不变.
        rerenderWithSameContent(utils!);

        // P1-1: 未确认勾选必须存活. 修复前: componentDidUpdate 见 selectedMembers
        // 引用变化 → setState 重置 localSelectedMembers → 勾选被静默回退.
        const zhangRowAfter = utils!.getAllByText('张三').map((el) => el.closest('.chat-selector-item')).find(Boolean)!;
        expect(zhangRowAfter.querySelector('input')!.checked).toBe(true);
    });

    it('候选并集收缩后只移除失效参与者，并保留仍在并集中的选择', async () => {
        let utils: ReturnType<typeof rtlRender>;
        await act(async () => {
            utils = rtlRender(
                <ChatSelectorModal
                    {...baseProps}
                    mode="members"
                    channel={null}
                    memberCandidates={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    selectedMembers={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    visible={false}
                />,
                { legacyRoot: true },
            );
        });

        await act(async () => {
            utils!.rerender(
                <ChatSelectorModal
                    {...baseProps}
                    mode="members"
                    channel={null}
                    memberCandidates={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    selectedMembers={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    visible
                />,
            );
        });

        await act(async () => {
            utils!.rerender(
                <ChatSelectorModal
                    {...baseProps}
                    mode="members"
                    channel={null}
                    memberCandidates={[{ uid: 'u2', name: '李四' }]}
                    selectedMembers={[
                        { uid: 'u1', name: '张三' },
                        { uid: 'u2', name: '李四' },
                    ]}
                    visible
                />,
            );
        });

        expect(utils!.queryByText('张三')).not.toBeInTheDocument();
        const liRow = utils!.getAllByText('李四').map((el) => el.closest('.chat-selector-item')).find(Boolean)!;
        expect(liRow.querySelector('input')!.checked).toBe(true);
    });
});
