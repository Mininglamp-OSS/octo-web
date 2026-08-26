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
 *   - L2 菜单：免@回答 / 卡片消息设置可点，两个占位行不触发；
 *   - L3 免@回答：分区渲染、搜索、开关回调、群管理员禁用、三种终态；
 *   - L3 卡片消息设置：总闸 AND 置灰、乐观更新 + PUT、取消自定义走 DELETE + 重拉、
 *     未覆盖行不显示取消自定义、App Bot（not_found）终态。
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
    cardSettings: 'Card messages',
    cardSettingsHint: 'Choose which card types this bot can send',
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
    searchFailed: 'Search failed, please retry',
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
        'bot.display_enabled': 'Text and images, view only',
        'bot.interaction_enabled': 'Buttons, forms and other interactive controls',
        'bot.reasoning_enabled': "Shows the bot's thinking steps",
    },
    masterLabel: 'Card message master switch',
    masterOn: 'Enabled',
    masterOffValue: 'Disabled',
    masterReadonly: 'Set by the server deployment; not editable here',
    masterOffNotice: 'None of the settings below take effect',
    needsDisplayNotice: 'Has no effect while display cards are off',
    sourceBot: 'Customized',
    sourceDefault: 'Not customized, following the default',
    sourceEnv: 'Set by the server',
    reset: 'Remove customization',
    loading: 'Loading...',
    loadFailed: 'Failed to load',
    reload: 'Reload',
    // 页面自己的文案，不复用 Bot 管理那条 —— 复用会让用户以为整个 Bot 管理没上线。
    backendComingSoon: 'Card message settings are coming soon',
    stayTuned: 'Stay tuned',
    unsupported: 'This kind of bot cannot be configured individually yet',
    forbidden: "Only the bot's creator can change these settings",
    empty: 'Nothing to configure',
    saveFailed: 'Could not save, please try again',
    saveFailedRetryable: 'Service temporarily unavailable, please retry later',
    rateLimited: (seconds?: number) =>
        seconds === undefined
            ? 'Too many requests'
            : `Too many requests, retry in ${seconds}s`,
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

        fireEvent.click(screen.getByText('Card messages'));
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
                searching={false}
                backendMissing={false}
                loadError={false}
                searchError={false}
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
                searching={false}
                backendMissing={false}
                loadError={false}
                searchError={false}
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

    it('search error keeps the search input clearable (non-terminal, inline message)', () => {
        // reviewer P1：搜索失败不能落进全屏终态——搜索框必须始终在，用户能清空关键字。
        const { onSearch } = renderList({
            searchError: true,
            searchKeyword: 'market',
            otherGroups: [{ groupNo: 'g1', name: 'Engineering', noMention: false }],
        });
        // inline 错误提示可见
        expect(
            screen.getByText('Search failed, please retry'),
        ).toBeInTheDocument();
        // 搜索框仍在且携带当前关键字，用户可清空触发新搜索
        const input = screen.getByTestId(
            'bot-manage-mention-search',
        ) as HTMLInputElement;
        expect(input).toBeInTheDocument();
        expect(input.value).toBe('market');
        fireEvent.change(input, { target: { value: '' } });
        expect(onSearch).toHaveBeenCalledWith('');
        // 已有列表保留，不被错误抹掉
        expect(screen.getByText('Engineering')).toBeInTheDocument();
    });
});

/**
 * 卡片消息设置用真实 VM + mock Service 跑，覆盖「VM snapshot → 视图 props」这段接线。
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
        expect(screen.getByText('Customized')).toBeInTheDocument();
        // source=global（interaction）和 source=default（reasoning）刻意收敛到同一句：
        // 两者对属主没有可操作性差异，分开写只会引出「这俩有啥区别」。
        expect(
            screen.getAllByText('Not customized, following the default'),
        ).toHaveLength(2);
        // 总闸自身不作为一行开关渲染。
        expect(screen.queryByTestId('bot-card-row-bot.card_enabled')).toBeNull();
    });

    it('orders rows reasoning → display → interaction', async () => {
        const vm = await seedVM();
        render(<CardSettingsHarness vm={vm} />);
        const rendered = Array.from(
            screen
                .getByTestId('bot-card-settings-list')
                .querySelectorAll('[data-testid^="bot-card-row-"]'),
        ).map((el) => el.getAttribute('data-testid'));
        expect(rendered).toEqual([
            'bot-card-row-bot.reasoning_enabled',
            'bot-card-row-bot.display_enabled',
            'bot-card-row-bot.interaction_enabled',
        ]);
    });

    it('shows the deployment master gate as a read-only status bar when enabled', async () => {
        const vm = await seedVM();
        render(<CardSettingsHarness vm={vm} />);

        // 总闸开启时也要常显：藏起来用户无从确认卡片能力整体可用，关闭时也没有
        // 锚点解释「我的开关为什么是灰的」。
        const bar = screen.getByTestId('bot-card-settings-master-on');
        expect(bar).toHaveTextContent('Card message master switch');
        expect(bar).toHaveTextContent('Enabled');
        expect(bar).toHaveTextContent('Set by the server deployment');
        // 刻意不是开关：该项服务端 editable:false，写它会 400。
        expect(bar.querySelector('[role="switch"]')).toBeNull();
    });

    it('master switch off greys out every sub-switch even when effective_value is true', async () => {
        const vm = await seedVM({ 'bot.card_enabled': { effective_value: false } });
        render(<CardSettingsHarness vm={vm} />);

        const bar = screen.getByTestId('bot-card-settings-master-off');
        expect(bar).toHaveTextContent('Disabled');
        expect(bar).toHaveTextContent('None of the settings below take effect');
        const display = screen.getByTestId('bot-card-switch-bot.display_enabled');
        // 服务端下发的 effective_value 仍是 true —— UI 必须自己 AND 总闸后显示为关。
        expect(display).toBeDisabled();
        expect(display).toHaveAttribute('aria-checked', 'false');
        fireEvent.click(display);
        await waitFor(() => expect(mocks.putSettings).not.toHaveBeenCalled());
    });

    it('disables remove-customization while the master gate is off', async () => {
        const vm = await seedVM({
            'bot.card_enabled': { effective_value: false },
            'bot.display_enabled': {
                value: false,
                effective_value: false,
                source: 'bot',
            },
        });
        render(<CardSettingsHarness vm={vm} />);

        // 按钮保留可见（「这里有个覆盖」是信息），但不可点 —— 整组开关都灰了、
        // 状态条也说了不生效，旁边留个能生效的删除动作会自相矛盾。
        const reset = screen.getByTestId('bot-card-reset-bot.display_enabled');
        expect(reset).toBeInTheDocument();
        expect(reset).toBeDisabled();
        fireEvent.click(reset);
        await waitFor(() => expect(mocks.deleteSetting).not.toHaveBeenCalled());
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
        expect(screen.queryByText('Remove customization')).toBeNull();
    });

    it('keeps long descriptions wrappable and the reset action off the switch row', async () => {
        const vm = await seedVM({
            'bot.interaction_enabled': {
                value: true,
                effective_value: true,
                source: 'bot',
            },
        });
        render(<CardSettingsHarness vm={vm} />);
        const row = screen.getByTestId('bot-card-row-bot.interaction_enabled');

        // 描述不能复用 .wk-bot-manage-group-status —— 那个类是为群名设计的
        // nowrap + ellipsis，英文长句会被截在词中间（"…other con…"）。
        expect(row.querySelector('.wk-bot-manage-card-desc')).not.toBeNull();
        expect(row.querySelector('.wk-bot-manage-group-status')).toBeNull();

        // 「取消自定义」不能和开关同行：英文标签比中文长一倍，抢宽度会把开关
        // 顶到容器边缘。
        const actions = row.querySelector('.wk-bot-manage-row-actions');
        expect(
            actions?.querySelector('[data-testid^="bot-card-reset-"]'),
        ).toBeFalsy();
        expect(
            row.querySelector(
                '.wk-bot-manage-card-meta [data-testid^="bot-card-reset-"]',
            ),
        ).not.toBeNull();
    });

    it('flags the interaction row when display cards are off, but keeps it writable', async () => {
        const vm = await seedVM({
            'bot.display_enabled': { effective_value: false },
        });
        render(<CardSettingsHarness vm={vm} />);

        expect(
            screen.getByTestId('bot-card-needs-display-bot.interaction_enabled'),
        ).toHaveTextContent('Has no effect while display cards are off');
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
            ).toHaveTextContent('Service temporarily unavailable, please retry later'),
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
        ).toHaveTextContent('This kind of bot cannot be configured individually yet');
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
                            'Card message settings are coming soon',
                        ),
                ),
            ),
        ).toBeInTheDocument();
        // 必须是这一页自己的文案：显示「Bot management is coming soon」会让用户
        // 以为整个 Bot 管理都没上线，而其实只有卡片设置这组端点缺失。
        expect(screen.queryByText(/Bot management is coming soon/)).toBeNull();
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
