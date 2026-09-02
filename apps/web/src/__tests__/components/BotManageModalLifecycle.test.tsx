/**
 * BotManageModal 生命周期测试。
 *
 * 单开一个文件而不是塞进 BotManage.test.tsx：这里要 stub 掉 OctoModal / RoutePage /
 * i18n 才能挂载真实的 modal，而那个文件刻意只喂纯视图 props，两种 mock 策略混在
 * 一个文件里会互相干扰。
 *
 * 断言的是「什么时候发请求」这条不变量。它反复过三轮：
 *   - 起初 L3 进页才拉，L2 零请求；
 *   - 中间为了判断「这个 bot 支不支持卡片设置」改成 L2 打开就探测一次，于是带出了
 *     首帧闪现、翻资料卡发请求、以及一个只写不清的模块级判定表；
 *   - 最后服务端确认 `users/:uid` 的 `bot_creator_uid` 就是精确的能力判据（与属主
 *     守卫同表、同 `status=1` 谓词），而 BotDetailModal 早就只在 isOwner 时渲染本
 *     组件 —— 探测整套删掉，回到 L2 零请求。
 * 所以「打开 Bot 管理不发任何请求」是要钉住的不变量，不是实现细节。
 *
 * stub 说明：
 *   - OctoModal → 只在 visible 时渲染 children。真 OctoModal 走 semi Modal 的进出场
 *     动画，jsdom 里 `animationend` 不触发，children 永远不卸载，测不出关闭语义。
 *   - RoutePage → 把 push 进来的节点真的渲染出来，否则到不了 L3。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import BotManageModal from '../../../../../packages/dmworkbase/src/Components/BotManage';

const mocks = vi.hoisted(() => ({
    listGroups: vi.fn(),
    listSettings: vi.fn(),
    putSettings: vi.fn(),
    deleteSetting: vi.fn(),
    enableMentionFree: vi.fn(),
    disableMentionFree: vi.fn(),
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

vi.mock('@octo/ui', async () => {
    const ReactMod = await import('react');
    const OctoModal = ({ visible, children }: any) =>
        visible ? ReactMod.createElement('div', null, children) : null;
    return { Modal: OctoModal };
});

vi.mock('../../../../../packages/dmworkbase/src/Components/RoutePage', async () => {
    const ReactMod = await import('react');
    const RoutePage = ({ render: renderFn }: any) => {
        const [pushed, setPushed] = ReactMod.useState<React.ReactNode>(null);
        const context = {
            push: (node: React.ReactNode) => setPushed(node),
            pop: () => setPushed(null),
        };
        return pushed ?? renderFn(context);
    };
    return { default: RoutePage, RoutePage };
});

vi.mock('../../../../../packages/dmworkbase/src/i18n', async () => {
    const ReactMod = await import('react');
    const t = (key: string) => key;
    return {
        I18nContext: ReactMod.createContext({ t }),
        t,
        useI18n: () => ({ t }),
    };
});

vi.mock('@douyinfe/semi-ui', () => ({
    Toast: { error: vi.fn(), success: vi.fn() },
}));

const CARD_SETTINGS_ROW = 'base.botManage.menu.cardSettings';

const settingItem = (key: string, overrides: Record<string, unknown> = {}) => ({
    key,
    type: 'bool',
    value: null,
    effective_value: true,
    source: 'default',
    editable: true,
    ...overrides,
});

const catalogue = () => ({
    list: [
        settingItem('bot.card_enabled', { editable: false, source: 'env' }),
        settingItem('bot.display_enabled'),
        settingItem('bot.interaction_enabled'),
        settingItem('bot.reasoning_enabled'),
    ],
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGroups.mockResolvedValue({ list: [], next_cursor: null, has_more: false });
    mocks.listSettings.mockResolvedValue(catalogue());
    mocks.putSettings.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
});

const flush = (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

const open = (robotId = 'bot1'): React.ReactElement => (
    <BotManageModal robotId={robotId} visible onClose={() => undefined} />
);
const closed = (robotId = 'bot1'): React.ReactElement => (
    <BotManageModal robotId={robotId} visible={false} onClose={() => undefined} />
);

describe('BotManageModal 生命周期', () => {
    it('关闭状态下不发任何请求', async () => {
        render(closed());
        await flush();
        expect(mocks.listSettings).not.toHaveBeenCalled();
    });

    it('打开 Bot 管理本身不拉卡片设置 —— 入口渲染不依赖任何请求', async () => {
        const { getByText } = render(open());
        await flush();
        // 能力判据来自 users/:uid 的 bot_creator_uid（BotDetailModal 的 isOwner
        // 门控），不需要探测请求。
        expect(mocks.listSettings).not.toHaveBeenCalled();
        expect(getByText(CARD_SETTINGS_ROW)).toBeInTheDocument();
    });

    it('翻资料卡（关闭态切 bot）不发请求', async () => {
        const { rerender } = render(closed('bot1'));
        await flush();
        rerender(closed('bot2'));
        rerender(closed('bot3'));
        await flush();
        expect(mocks.listSettings).not.toHaveBeenCalled();
    });

    it('进入卡片设置才拉，拉的是当前 bot', async () => {
        const { getByText, getByTestId } = render(open());
        await flush();
        expect(mocks.listSettings).not.toHaveBeenCalled();

        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot1');
        expect(getByTestId('bot-card-settings-list')).toBeInTheDocument();
    });

    it('关闭再打开后重新进入会再拉一次，而不是复用 VM 里的旧数据', async () => {
        const { rerender, getByText } = render(open());
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);

        rerender(closed());
        await flush();
        rerender(open());
        await flush();
        // 关闭时 L3 随 modal 内容一起卸载，但 VM 仍被 modal 持有；再进入必须重拉，
        // 否则等于把 no-store 的响应缓存到 VM 生命周期。
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
    });

    it('切 bot 后再进入卡片设置，拉的是新 bot（旧 VM 被丢弃）', async () => {
        const { rerender, getByText } = render(open('bot1'));
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot1');

        // 真实路径是先关闭再切（L3 随 modal 内容卸载，回到 L2 菜单）。
        rerender(closed('bot1'));
        await flush();
        rerender(closed('bot2'));
        await flush();
        // 关闭态切 bot 依然零请求，只是把旧 VM 丢掉。
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);

        rerender(open('bot2'));
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot2');
    });

    /**
     * 交集回归：写入落库会让在飞的读作废（writeSeq 判据），而那个被作废的读**必须
     * 自己清掉 loading** —— 否则「是否已有在飞请求」这个守卫会把之后每一次进入的
     * 读取全部吞掉，「每次进入一次新鲜读取」静默失效且没有可见症状。
     */
    it('在飞读取期间写入落库后，下一次进入仍然重拉', async () => {
        const { rerender, getByText, getByTestId } = render(open());
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);

        // 第二次进入：读挂在飞，此时点开关让 PUT 落库。页面因为 VM 已有数据而直接
        // 渲染行（不是 spinner），所以开关可点。
        rerender(closed());
        await flush();
        rerender(open());
        await flush();
        let releaseRead: (value: unknown) => void = () => undefined;
        mocks.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve;
                }),
        );
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        fireEvent.click(getByTestId('bot-card-switch-bot.display_enabled'));
        await flush();
        expect(mocks.putSettings).toHaveBeenCalledTimes(1);

        releaseRead(catalogue()); // 落地时已被 writeSeq 判掉
        await flush();

        // 第三次进入必须仍然发出请求。
        rerender(closed());
        await flush();
        rerender(open());
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(3);
    });

    it('卸载后请求才回来，不因通知已卸载组件而报错', async () => {
        let releaseRead: (value: unknown) => void = () => undefined;
        mocks.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve;
                }),
        );
        const { getByText, unmount } = render(open());
        await flush();
        fireEvent.click(getByText(CARD_SETTINGS_ROW));
        await flush();
        unmount();

        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        releaseRead(catalogue());
        await flush();
        expect(error).not.toHaveBeenCalled();
    });
});
