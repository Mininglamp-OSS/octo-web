/**
 * BotManageModal 生命周期测试（PR #1282 第二轮 review P2.7）。
 *
 * 单开一个文件而不是塞进 BotManage.test.tsx：这里要 stub 掉 WKModal / RoutePage /
 * i18n 才能挂载真实的 modal，而那个文件刻意只喂纯视图 props，两种 mock 策略混在
 * 一个文件里会互相干扰。
 *
 * 为什么必须挂载真组件：`c1bad240` 改动的三个行为 —— 重开必须重拉（读接口是
 * `no-store`）、翻资料卡不能发请求、卸载时 dispose —— 全在 `componentDidUpdate`
 * 的分支里，纯视图测试和直接驱动 VM 都碰不到。上一轮的 P2.5（不支持的 bot 菜单行
 * 闪现）就是被这个盲区藏住的。
 *
 * stub 说明：
 *   - WKModal → 只在 visible 时渲染 children。真 WKModal 走 semi Modal 的进出场
 *     动画，jsdom 里 `animationend` 不触发，children 永远不卸载，测不出关闭语义。
 *   - RoutePage → 直接调 props.render(假 context)，跳过路由栈（L3 的 push 不在本文件
 *     的关注点内）。
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
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

vi.mock('../../../../../packages/dmworkbase/src/Components/WKModal', async () => {
    const ReactMod = await import('react');
    const WKModal = ({ visible, children }: any) =>
        visible ? ReactMod.createElement('div', null, children) : null;
    return { default: WKModal, WKModal };
});

vi.mock('../../../../../packages/dmworkbase/src/Components/RoutePage', async () => {
    const RoutePage = ({ render: renderFn }: any) =>
        renderFn({ push: () => undefined, pop: () => undefined });
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
});

afterEach(() => {
    vi.restoreAllMocks();
});

const flush = (): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

describe('BotManageModal 生命周期', () => {
    it('关闭状态下不拉卡片设置', async () => {
        render(<BotManageModal robotId="bot1" visible={false} onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).not.toHaveBeenCalled();
    });

    it('每次打开都重拉一次（读接口 no-store，不能靠 hasData 守卫）', async () => {
        const { rerender } = render(
            <BotManageModal robotId="bot1" visible={false} onClose={() => undefined} />,
        );
        await flush();

        rerender(<BotManageModal robotId="bot1" visible onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot1');

        // 关闭再打开：VM 跨开关存活（本组件跟资料卡一起常驻挂载），若用 hasData
        // 守卫这里一个请求都不会发，等于把 no-store 的响应缓存掉。
        rerender(<BotManageModal robotId="bot1" visible={false} onClose={() => undefined} />);
        await flush();
        rerender(<BotManageModal robotId="bot1" visible onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
    });

    it('关闭状态下切 bot 不发请求，下次打开才拉且拉的是新 bot', async () => {
        const { rerender } = render(
            <BotManageModal robotId="bot1" visible onClose={() => undefined} />,
        );
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);

        rerender(<BotManageModal robotId="bot1" visible={false} onClose={() => undefined} />);
        await flush();

        // 翻资料卡（robotId 变、但面板是关的）：一个限流 GET 都不该发。
        rerender(<BotManageModal robotId="bot2" visible={false} onClose={() => undefined} />);
        rerender(<BotManageModal robotId="bot3" visible={false} onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(1);

        rerender(<BotManageModal robotId="bot3" visible onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot3');
    });

    it('打开状态下切 bot 会重拉新 bot', async () => {
        const { rerender } = render(
            <BotManageModal robotId="bot1" visible onClose={() => undefined} />,
        );
        await flush();
        rerender(<BotManageModal robotId="bot2" visible onClose={() => undefined} />);
        await flush();
        expect(mocks.listSettings).toHaveBeenCalledTimes(2);
        expect(mocks.listSettings).toHaveBeenLastCalledWith('bot2');
    });

    it('不支持的 bot 不渲染卡片设置入口，且重开时不会闪现', async () => {
        mocks.listSettings.mockRejectedValue({
            code: 'err.server.robot.not_found',
            status: 404,
            msg: 'not found',
        });
        const { rerender, queryByText } = render(
            <BotManageModal robotId="appbot1" visible onClose={() => undefined} />,
        );
        await flush();
        expect(queryByText(CARD_SETTINGS_ROW)).toBeNull();

        // 重开会再拉一次；loadSettings 若在 await 之前清 loadError，isUnsupported
        // 会瞬间变 false，这一行就会画出来（还可点）再撤掉。
        rerender(<BotManageModal robotId="appbot1" visible={false} onClose={() => undefined} />);
        await flush();
        rerender(<BotManageModal robotId="appbot1" visible onClose={() => undefined} />);
        expect(queryByText(CARD_SETTINGS_ROW)).toBeNull(); // 同步帧：不能闪现
        await flush();
        expect(queryByText(CARD_SETTINGS_ROW)).toBeNull();
    });

    it('能力未知（服务端错误）时保留入口，不藏掉功能', async () => {
        mocks.listSettings.mockRejectedValue({
            code: 'err.server.robot.query_failed',
            status: 500,
            msg: 'boom',
        });
        const { queryByText } = render(
            <BotManageModal robotId="bot1" visible onClose={() => undefined} />,
        );
        await flush();
        expect(queryByText(CARD_SETTINGS_ROW)).not.toBeNull();
    });

    it('卸载后不再因 VM 通知而渲染（订阅已解除）', async () => {
        let releaseRead: (value: unknown) => void = () => undefined;
        mocks.listSettings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    releaseRead = resolve;
                }),
        );
        const { unmount } = render(
            <BotManageModal robotId="bot1" visible onClose={() => undefined} />,
        );
        await flush();
        unmount();

        // 卸载后请求才回来：不能因为 forceUpdate 打到已卸载组件而报错。
        const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        releaseRead(catalogue());
        await flush();
        expect(warn).not.toHaveBeenCalled();
    });
});
