/**
 * BotManage 组件测试（octo-web#235 / YUJ-2838）。
 *
 * 放在 apps/web/__tests__/components/ 而非 dmworkbase 包内，与 BotDetailModalRemark
 * 同因：dmworkbase 包的 vitest 跑在 React 17，@testing-library/react 18 的 hooks
 * 会报 "Invalid hook call"。apps/web 的 vitest 把 react/react-dom 别名到 18 并 inline
 * semi，是 dmworkbase RTL 组件测试的既有落点。
 *
 * 覆盖（issue 验收）：
 *   - BotManageMenu L2：仅「💬 免@回答」可点 → onOpenMentionFree 触发；
 *     ✅自动通过 / ✏️简介指令 disabled 占位不触发。
 *   - MentionFreeList L3：渲染分区、客户端搜索过滤、开关 onCheck 走 PUT/DELETE、
 *     失败回弹、404→功能即将上线。
 *
 * i18n 走显式 dict mock（locale 稳定，不依赖 jsdom navigator.language）。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    apiGet: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock('../../../../../packages/dmworkbase/src/App', () => ({
    default: {
        apiClient: {
            get: mocks.apiGet,
            put: mocks.apiPut,
            delete: mocks.apiDelete,
        },
        loginInfo: { uid: 'viewer', token: '' },
        shared: { currentSpaceId: '' },
    },
}));

vi.mock('@douyinfe/semi-ui', async () => {
    const ReactMod = await import('react');
    return {
        Switch: ({ checked, loading }: any) =>
            ReactMod.createElement('input', {
                type: 'checkbox',
                checked: !!checked,
                'data-loading': loading ? '1' : '0',
                readOnly: true,
            }),
        Toast: { error: mocks.toastError },
    };
});

vi.mock('../../../../../packages/dmworkbase/src/i18n', async () => {
    const ReactMod = await import('react');
    const dict: Record<string, string> = {
        'botManage.title': 'Bot Management',
        'botManage.loading': 'Loading...',
        'botManage.loadFailed': 'Failed to load',
        'botManage.reload': 'Reload',
        'botManage.backendComingSoon': 'Bot management is coming soon',
        'botManage.stayTuned': 'Stay tuned',
        'botManage.comingSoon': 'Coming soon',
        'botManage.menu.mentionFree': 'Reply without @',
        'botManage.menu.autoApprove': 'Auto-approve friend requests',
        'botManage.menu.profileCommands': 'Profile & commands',
        'botManage.mentionFree.title': 'Reply without @',
        'botManage.mentionFree.searchPlaceholder': 'Search group name',
        'botManage.mentionFree.empty': "This bot hasn't joined any groups yet",
        'botManage.mentionFree.noSearchResult': 'No matching groups',
        'botManage.mentionFree.sectionEnabled': 'Reply-without-@ enabled ({{count}})',
        'botManage.mentionFree.sectionOthers': 'Other groups',
        'botManage.mentionFree.toggleFailed': 'Failed to update',
    };
    const translate = (key: string, options?: any) => {
        let s = dict[key.replace(/^base\./, '')] || key;
        const values = options?.values;
        if (values) {
            for (const k of Object.keys(values)) {
                s = s.replace(`{{${k}}}`, String(values[k]));
            }
        }
        return s;
    };
    return {
        I18nContext: ReactMod.createContext({ t: translate }),
        t: translate,
        useI18n: () => ({ t: translate }),
    };
});

import BotManageMenu from '../../../../../packages/dmworkbase/src/Components/BotManage/BotManageMenu';
import MentionFreeList from '../../../../../packages/dmworkbase/src/Components/BotManage/MentionFreeList';
import { MentionFreeVM } from '../../../../../packages/dmworkbase/src/Components/BotManage/vm';

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('BotManageMenu (L2)', () => {
    it('only the mention-free row is clickable; placeholders do not fire', () => {
        const onOpen = vi.fn();
        render(<BotManageMenu onOpenMentionFree={onOpen} />);

        fireEvent.click(screen.getByText('Reply without @'));
        expect(onOpen).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Auto-approve friend requests'));
        fireEvent.click(screen.getByText('Profile & commands'));
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

describe('MentionFreeList (L3)', () => {
    const seedVM = async (
        list: any[],
        opts: Partial<{ next: string | null; more: boolean }> = {},
    ) => {
        mocks.apiGet.mockResolvedValueOnce({
            list,
            next_cursor: opts.next ?? null,
            has_more: opts.more ?? false,
        });
        const vm = new MentionFreeVM('bot1');
        await vm.loadGroups();
        return vm;
    };

    it('renders enabled (pinned) and other groups with section titles', async () => {
        const vm = await seedVM([
            { group_no: 'g1', name: 'Alpha', no_mention: false },
            { group_no: 'g2', name: 'Beta', no_mention: true },
        ]);
        render(<MentionFreeList vm={vm} />);
        expect(await screen.findByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.getByText(/Reply-without-@ enabled/)).toBeInTheDocument();
        expect(screen.getByText('Other groups')).toBeInTheDocument();
    });

    it('client-side search filters loaded groups by name', async () => {
        const vm = await seedVM([
            { group_no: 'g1', name: 'Engineering', no_mention: false },
            { group_no: 'g2', name: 'Marketing', no_mention: false },
        ]);
        render(<MentionFreeList vm={vm} />);
        await screen.findByText('Engineering');
        fireEvent.change(screen.getByTestId('bot-manage-mention-search'), {
            target: { value: 'market' },
        });
        await waitFor(() => {
            expect(screen.queryByText('Engineering')).not.toBeInTheDocument();
        });
        expect(screen.getByText('Marketing')).toBeInTheDocument();
    });

    it('toggling a group ON → PUT mention_pref {no_mention:1}', async () => {
        const vm = await seedVM([{ group_no: 'g1', name: 'Alpha', no_mention: false }]);
        mocks.apiPut.mockResolvedValueOnce({});
        render(<MentionFreeList vm={vm} />);
        const cb = (await screen.findByText('Alpha'))
            .closest('.wk-list-item')!
            .querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(cb.checked).toBe(false);
        fireEvent.click(cb);
        await waitFor(() =>
            expect(mocks.apiPut).toHaveBeenCalledWith(
                'robot/bot1/groups/g1/mention_pref',
                { no_mention: 1 },
            ),
        );
    });

    it('toggling a group OFF → DELETE mention_pref', async () => {
        const vm = await seedVM([{ group_no: 'g1', name: 'Alpha', no_mention: true }]);
        mocks.apiDelete.mockResolvedValueOnce({});
        render(<MentionFreeList vm={vm} />);
        const cb = (await screen.findByText('Alpha'))
            .closest('.wk-list-item')!
            .querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(cb.checked).toBe(true);
        fireEvent.click(cb);
        await waitFor(() =>
            expect(mocks.apiDelete).toHaveBeenCalledWith('robot/bot1/groups/g1/mention_pref'),
        );
    });

    it('toggle failure bounces the switch back (no_mention unchanged)', async () => {
        const vm = await seedVM([{ group_no: 'g1', name: 'Alpha', no_mention: false }]);
        mocks.apiPut.mockRejectedValueOnce({ status: 500, msg: 'boom' });
        render(<MentionFreeList vm={vm} />);
        const cb = (await screen.findByText('Alpha'))
            .closest('.wk-list-item')!
            .querySelector('input[type="checkbox"]') as HTMLInputElement;
        fireEvent.click(cb);
        await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('boom'));
        await waitFor(() => {
            const cb2 = screen
                .getByText('Alpha')
                .closest('.wk-list-item')!
                .querySelector('input[type="checkbox"]') as HTMLInputElement;
            expect(cb2.checked).toBe(false);
        });
    });

    it('shows backend-coming-soon on 404', async () => {
        mocks.apiGet.mockRejectedValueOnce({ status: 404 });
        const vm = new MentionFreeVM('bot1');
        await vm.loadGroups();
        render(<MentionFreeList vm={vm} />);
        expect(
            await screen.findByText((_content, el) =>
                el?.className === 'wk-bot-manage-empty' &&
                (el.textContent || '').includes('Bot management is coming soon'),
            ),
        ).toBeInTheDocument();
    });
});
