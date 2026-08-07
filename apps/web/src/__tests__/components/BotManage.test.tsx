/**
 * BotManage 组件测试。
 *
 * 放在 apps/web/__tests__/components/ 而非 dmworkbase 包内，与 BotDetailModalRemark
 * 同因：dmworkbase 包的 vitest 跑在 React 17，@testing-library/react 18 的 hooks
 * 会报 "Invalid hook call"。apps/web 的 vitest 把 react/react-dom 别名到 18 并 inline
 * semi，是 dmworkbase RTL 组件测试的既有落点。
 *
 * ⚠️ 本文件此前失效：refactor(profile) #889/#890/#891 把 BotManage 拆成
 * `ui/profileDetail/BotManageView`（纯视图）+ `bridge/profileDetail/*VM`（VM）+
 * `Service/BotManageService`（数据），但测试仍 import 已删除的
 * `Components/BotManage/{BotManageMenu,MentionFreeList,vm}`，整个文件在 collect
 * 阶段就 "Failed to resolve import"。这里按当前分层重写：
 *   - 视图是纯受控组件（labels 注入、不碰 i18n）→ 直接喂 props，不再 mock i18n；
 *   - 数据层从 `WKApp.apiClient` 换成了 `BotManageService` → mock 该模块，
 *     不再 mock App。
 *
 * 覆盖：
 *   - L2 菜单：免@回答 / 卡片消息能力可点，两个占位行不触发；
 *   - L3 免@回答：分区渲染、搜索、开关回调、群管理员禁用、三种终态；
 *   - L3 卡片消息能力：总闸 AND 置灰、乐观更新 + PUT、恢复默认走 DELETE + 重拉、
 *     未覆盖行不显示恢复默认、App Bot（not_found）终态。
 */

import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import BotManageView, {
    CardSettingsView,
    MentionFreeListView,
    type BotCardSettingsLabels,
    type BotManageViewLabels,
} from '../../../../../packages/dmworkbase/src/ui/profileDetail/BotManageView';
import { MentionFreeVM } from '../../../../../packages/dmworkbase/src/bridge/profileDetail/BotManageVM';
import { BotCardSettingsVM } from '../../../../../packages/dmworkbase/src/bridge/profileDetail/BotCardSettingsVM';
import type { BotSettingItem } from '../../../../../packages/dmworkbase/src/Service/BotManageService';

const mocks = vi.hoisted(() => ({
    listGroups: vi.fn(),
    enableMentionFree: vi.fn(),
    disableMentionFree: vi.fn(),
    listSettings: vi.fn(),
    putSettings: vi.fn(),
    deleteSetting: vi.fn(),
}));

vi.mock('../../../../../packages/dmworkbase/src/Service/BotManageService', () => ({
    default: {
        listGroups: mocks.listGroups,
        enableMentionFree: mocks.enableMentionFree,
        disableMentionFree: mocks.disableMentionFree,
        listSettings: mocks.listSettings,
        putSettings: mocks.putSettings,
        deleteSetting: mocks.deleteSetting,
    },
}));

const labels: BotManageViewLabels = {
    mentionFree: 'Reply without @',
    mentionFreeHint: 'Choose groups where the bot can reply without @',
    cardSettings: 'Card message capabilities',
    cardSettingsHint: 'Control which card message types this bot can send',
    autoApprove: 'Auto-approve friend requests',
    autoApproveHint: 'Later',
    profileCommands: 'Profile & commands',
    profileCommandsHint: 'Later',
    comingSoon: 'Coming soon',
    loading: 'Loading...',
    backendComingSoon: 'Bot management is coming soon',
    stayTuned: 'Stay tuned',
    loadFailed: 'Failed to load',
    reload: 'Reload',
    searchPlaceholder: 'Search group name',
    noSearchResult: 'No matching groups',
    empty: "This bot hasn't joined any groups yet",
    sectionEnabled: (count: number) => `Reply-without-@ enabled (${count})`,
    sectionOthers: 'Other groups',
    rowOn: 'Reply without @ is enabled',
    rowOff: 'Requires @ to reply',
    rowBlocked: 'Group admin disabled reply without @',
};

const cardLabels: BotCardSettingsLabels = {
    rowTitle: {
        'bot.display_enabled': 'Display cards',
        'bot.interaction_enabled': 'Interactive cards',
        'bot.reasoning_enabled': 'Reasoning cards',
    },
    rowDesc: {
        'bot.display_enabled': 'Allow display-only cards',
        'bot.interaction_enabled': 'Allow interactive cards',
        'bot.reasoning_enabled': 'Allow reasoning cards',
    },
    masterOffNotice: 'Card messages are turned off for this deployment',
    needsDisplayNotice: 'Enable display cards first',
    sourceBot: 'Customized for this bot',
    sourceGlobal: 'Inherited from the global default',
    sourceDefault: 'Inherited from the system default',
    sourceEnv: 'Determined by the deployment environment',
    reset: 'Restore default',
    loading: 'Loading...',
    loadFailed: 'Failed to load',
    reload: 'Reload',
    backendComingSoon: 'Bot management is coming soon',
    stayTuned: 'Stay tuned',
    unsupported: 'This bot type does not support customization yet',
    forbidden: 'Only the bot creator can change these settings',
    empty: 'No configurable options',
    saveFailed: 'Failed to update',
    saveFailedRetryable: 'Service temporarily unavailable, please retry',
    rateLimited: 'Too many requests',
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.putSettings.mockResolvedValue(undefined);
    mocks.deleteSetting.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('BotManageView (L2 menu)', () => {
    it('routes both live rows and ignores the two coming-soon placeholders', () => {
        const onMentionFree = vi.fn();
        const onCardSettings = vi.fn();
        render(
            <BotManageView
                labels={labels}
                onOpenMentionFree={onMentionFree}
                onOpenCardSettings={onCardSettings}
            />,
        );

        fireEvent.click(screen.getByText('Reply without @'));
        expect(onMentionFree).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Card message capabilities'));
        expect(onCardSettings).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByText('Auto-approve friend requests'));
        fireEvent.click(screen.getByText('Profile & commands'));
        expect(onMentionFree).toHaveBeenCalledTimes(1);
        expect(onCardSettings).toHaveBeenCalledTimes(1);
    });
});

describe('MentionFreeListView (L3)', () => {
    const renderList = (
        props: Partial<React.ComponentProps<typeof MentionFreeListView>> = {},
    ) => {
        const onToggle = vi.fn();
        const onSearch = vi.fn();
        const onReload = vi.fn();
        render(
            <MentionFreeListView
                labels={labels}
                loading={false}
                backendMissing={false}
                loadError={false}
                searchKeyword=""
                enabledGroups={[]}
                otherGroups={[]}
                loadingMore={false}
                onSearchKeywordChange={onSearch}
                onReload={onReload}
                onLoadMore={() => undefined}
                onToggleMentionFree={onToggle}
                {...props}
            />,
        );
        return { onToggle, onSearch, onReload };
    };

    it('renders enabled (pinned) and other groups with section titles', () => {
        renderList({
            enabledGroups: [{ groupNo: 'g2', name: 'Beta', noMention: true }],
            otherGroups: [{ groupNo: 'g1', name: 'Alpha', noMention: false }],
        });
        expect(screen.getByText('Beta')).toBeInTheDocument();
        expect(screen.getByText('Alpha')).toBeInTheDocument();
        expect(screen.getByText('Reply-without-@ enabled (1)')).toBeInTheDocument();
        expect(screen.getByText('Other groups')).toBeInTheDocument();
    });

    it('search input reports keyword changes upward', () => {
        const { onSearch } = renderList({
            otherGroups: [{ groupNo: 'g1', name: 'Engineering', noMention: false }],
        });
        fireEvent.change(screen.getByTestId('bot-manage-mention-search'), {
            target: { value: 'market' },
        });
        expect(onSearch).toHaveBeenCalledWith('market');
    });

    it('toggling a row asks for the opposite of its current state', () => {
        const { onToggle } = renderList({
            otherGroups: [{ groupNo: 'g1', name: 'Alpha', noMention: false }],
        });
        fireEvent.click(screen.getByRole('switch'));
        expect(onToggle).toHaveBeenCalledWith('g1', true, expect.anything());
    });

    it('a group whose admin disabled mention-free is not togglable', () => {
        const { onToggle } = renderList({
            otherGroups: [
                {
                    groupNo: 'g1',
                    name: 'Alpha',
                    noMention: false,
                    allowNoMention: false,
                },
            ],
        });
        const sw = screen.getByRole('switch');
        expect(sw).toBeDisabled();
        fireEvent.click(sw);
        expect(onToggle).not.toHaveBeenCalled();
        expect(
            screen.getByText('Group admin disabled reply without @'),
        ).toBeInTheDocument();
    });

    it('renders loading / backend-coming-soon / load-error terminal states', () => {
        const { unmount } = render(
            <MentionFreeListView
                labels={labels}
                loading
                backendMissing={false}
                loadError={false}
                searchKeyword=""
                enabledGroups={[]}
                otherGroups={[]}
                loadingMore={false}
                onSearchKeywordChange={() => undefined}
                onReload={() => undefined}
                onLoadMore={() => undefined}
                onToggleMentionFree={() => undefined}
            />,
        );
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        unmount();

        renderList({ backendMissing: true });
        expect(
            screen.getByText((_c, el) =>
                Boolean(
                    el?.className === 'wk-bot-manage-empty' &&
                        (el.textContent || '').includes(
                            'Bot management is coming soon',
                        ),
                ),
            ),
        ).toBeInTheDocument();
    });

    it('load error offers a retry that calls back', () => {
        const { onReload } = renderList({ loadError: true });
        fireEvent.click(screen.getByText('Reload'));
        expect(onReload).toHaveBeenCalledTimes(1);
    });
});

/**
 * 卡片消息能力用真实 VM + mock Service 跑，覆盖「VM snapshot → 视图 props」这段接线。
 *
 * 这里的 harness 复刻 Components/BotManage 里 CardSettingsContainer 的订阅逻辑
 * （addListener + forceUpdate）—— 那个容器是模块内部实现，没有导出。
 */
function CardSettingsHarness({ vm }: { vm: BotCardSettingsVM }) {
    const [, bump] = useState(0);
    useEffect(() => vm.addListener(() => bump((n) => n + 1)), [vm]);
    const { rows, masterEnabled } = vm.snapshot();
    return (
        <CardSettingsView
            labels={cardLabels}
            rows={rows}
            masterEnabled={masterEnabled}
            loading={vm.loading}
            hasData={vm.hasData}
            loadErrorKind={vm.loadError?.kind}
            writeErrorKind={vm.writeError?.kind}
            onToggle={(key, next) => vm.toggle(key, next)}
            onReset={(key) => void vm.resetToDefault(key)}
            onReload={() => vm.reload()}
        />
    );
}

describe('CardSettingsView (L3)', () => {
    const settingItem = (
        key: string,
        overrides: Partial<BotSettingItem> = {},
    ): BotSettingItem => ({
        key,
        type: 'bool',
        value: null,
        effective_value: true,
        source: 'default',
        editable: true,
        ...overrides,
    });

    const catalog = (
        overrides: Record<string, Partial<BotSettingItem>> = {},
    ) => ({
        list: [
            settingItem('bot.card_enabled', {
                editable: false,
                source: 'env',
                ...overrides['bot.card_enabled'],
            }),
            settingItem('bot.display_enabled', overrides['bot.display_enabled']),
            settingItem(
                'bot.interaction_enabled',
                overrides['bot.interaction_enabled'],
            ),
            settingItem('bot.reasoning_enabled', overrides['bot.reasoning_enabled']),
        ],
    });

    const seedVM = async (
        overrides: Record<string, Partial<BotSettingItem>> = {},
    ) => {
        mocks.listSettings.mockResolvedValueOnce(catalog(overrides));
        const vm = new BotCardSettingsVM('bot1', { retryDelayMs: 0 });
        await vm.loadSettings();
        return vm;
    };

    it('renders the three sub-switches with their source subtitles', async () => {
        const vm = await seedVM({
            'bot.display_enabled': { value: false, effective_value: false, source: 'bot' },
            'bot.interaction_enabled': { source: 'global' },
        });
        render(<CardSettingsHarness vm={vm} />);

        expect(screen.getByText('Display cards')).toBeInTheDocument();
        expect(screen.getByText('Interactive cards')).toBeInTheDocument();
        expect(screen.getByText('Reasoning cards')).toBeInTheDocument();
        expect(screen.getByText('Customized for this bot')).toBeInTheDocument();
        expect(
            screen.getByText('Inherited from the global default'),
        ).toBeInTheDocument();
        // 总闸自身不作为一行开关渲染。
        expect(screen.queryByTestId('bot-card-row-bot.card_enabled')).toBeNull();
    });

    it('master switch off greys out every sub-switch even when effective_value is true', async () => {
        const vm = await seedVM({ 'bot.card_enabled': { effective_value: false } });
        render(<CardSettingsHarness vm={vm} />);

        expect(screen.getByTestId('bot-card-settings-master-off')).toBeInTheDocument();
        const display = screen.getByTestId('bot-card-switch-bot.display_enabled');
        // 服务端下发的 effective_value 仍是 true —— UI 必须自己 AND 总闸后显示为关。
        expect(display).toBeDisabled();
        expect(display).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(display);
        await waitFor(() => expect(mocks.putSettings).not.toHaveBeenCalled());
    });

    it('toggling writes the override and reflects it optimistically', async () => {
        const vm = await seedVM();
        render(<CardSettingsHarness vm={vm} />);

        fireEvent.click(screen.getByTestId('bot-card-switch-bot.display_enabled'));
        await waitFor(() =>
            expect(mocks.putSettings).toHaveBeenCalledWith('bot1', [
                { key: 'bot.display_enabled', value: false },
            ]),
        );
        expect(
            screen.getByTestId('bot-card-switch-bot.display_enabled'),
        ).toHaveAttribute('aria-checked', 'false');
        // 写入后变成显式覆盖 → 出现「恢复默认」。
        expect(
            screen.getByTestId('bot-card-reset-bot.display_enabled'),
        ).toBeInTheDocument();
    });

    it('restore-default deletes the override and refetches the fallback value', async () => {
        const vm = await seedVM({
            'bot.reasoning_enabled': { value: true, effective_value: true, source: 'bot' },
        });
        // 删掉覆盖后回落到代码默认 false —— 这个值只有服务端知道，必须重拉。
        mocks.listSettings.mockResolvedValueOnce(
            catalog({
                'bot.reasoning_enabled': {
                    value: null,
                    effective_value: false,
                    source: 'default',
                },
            }),
        );
        render(<CardSettingsHarness vm={vm} />);

        fireEvent.click(screen.getByTestId('bot-card-reset-bot.reasoning_enabled'));
        await waitFor(() =>
            expect(mocks.deleteSetting).toHaveBeenCalledWith(
                'bot1',
                'bot.reasoning_enabled',
            ),
        );
        await waitFor(() =>
            expect(
                screen.getByTestId('bot-card-switch-bot.reasoning_enabled'),
            ).toHaveAttribute('aria-checked', 'false'),
        );
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
        // 覆盖已删除 → 按钮消失，且该行重新可用（不因重拉自增 generation 而卡住）。
        expect(screen.queryByTestId('bot-card-reset-bot.reasoning_enabled')).toBeNull();
        expect(
            screen.getByTestId('bot-card-switch-bot.reasoning_enabled'),
        ).not.toBeDisabled();
    });

    it('rows without an explicit override offer no restore-default button', async () => {
        const vm = await seedVM();
        render(<CardSettingsHarness vm={vm} />);
        expect(screen.queryByText('Restore default')).toBeNull();
    });

    it('flags the interaction row when display cards are off, but keeps it writable', async () => {
        const vm = await seedVM({
            'bot.display_enabled': { effective_value: false },
        });
        render(<CardSettingsHarness vm={vm} />);

        expect(
            screen.getByTestId('bot-card-needs-display-bot.interaction_enabled'),
        ).toHaveTextContent('Enable display cards first');
        expect(
            screen.getByTestId('bot-card-switch-bot.interaction_enabled'),
        ).not.toBeDisabled();
    });

    it('server-side failure asks the user to retry rather than to fix input', async () => {
        const vm = await seedVM();
        mocks.putSettings.mockRejectedValue({
            code: 'err.server.robot.store_failed',
            status: 500,
            msg: 'boom',
        });
        render(<CardSettingsHarness vm={vm} />);

        fireEvent.click(screen.getByTestId('bot-card-switch-bot.display_enabled'));
        await waitFor(() =>
            expect(
                screen.getByTestId('bot-card-settings-write-error'),
            ).toHaveTextContent('Service temporarily unavailable, please retry'),
        );
        // 整批回滚 → 开关弹回服务端真实状态。
        expect(
            screen.getByTestId('bot-card-switch-bot.display_enabled'),
        ).toHaveAttribute('aria-checked', 'true');
    });

    it('App Bot (robot.not_found) gets its own terminal copy, not coming-soon', async () => {
        mocks.listSettings.mockRejectedValueOnce({
            code: 'err.server.robot.not_found',
            status: 404,
            msg: 'not found',
        });
        const vm = new BotCardSettingsVM('appbot1', { retryDelayMs: 0 });
        await vm.loadSettings();
        render(<CardSettingsHarness vm={vm} />);

        expect(
            screen.getByTestId('bot-card-settings-unsupported'),
        ).toHaveTextContent('This bot type does not support customization yet');
        expect(screen.queryByText('Reload')).toBeNull();
    });

    it('a missing backend route still shows the coming-soon skeleton', async () => {
        mocks.listSettings.mockRejectedValueOnce({ status: 404, msg: 'nope' });
        const vm = new BotCardSettingsVM('bot1', { retryDelayMs: 0 });
        await vm.loadSettings();
        render(<CardSettingsHarness vm={vm} />);

        expect(
            screen.getByText((_c, el) =>
                Boolean(
                    el?.className === 'wk-bot-manage-empty' &&
                        (el.textContent || '').includes(
                            'Bot management is coming soon',
                        ),
                ),
            ),
        ).toBeInTheDocument();
    });
});

describe('MentionFreeVM wiring stays on BotManageService', () => {
    it('loads groups through the service layer, not a raw api client', async () => {
        mocks.listGroups.mockResolvedValueOnce({
            list: [{ group_no: 'g1', name: 'Alpha', no_mention: false }],
            next_cursor: null,
            has_more: false,
        });
        const vm = new MentionFreeVM('bot1');
        await vm.loadGroups();
        expect(mocks.listGroups).toHaveBeenCalledWith({
            robotId: 'bot1',
            limit: 30,
        });
        expect(vm.visibleGroups().others).toHaveLength(1);
    });
});
