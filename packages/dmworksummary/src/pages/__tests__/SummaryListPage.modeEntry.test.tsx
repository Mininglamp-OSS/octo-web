import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Dropdown: () => null,
    SplitButtonGroup: ({ children }: any) => <div>{children}</div>,
    Spin: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
    Tooltip: ({ children }: any) => <>{children}</>,
}));
vi.mock('@douyinfe/semi-icons', () => ({
    IconSearch: () => null,
    IconPlus: () => null,
}));
vi.mock('lucide-react', () => ({
    X: () => null,
    ChevronDown: () => null,
}));
vi.mock('../../components/SummaryCard', () => ({ default: () => null }));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import { WKApp } from '@octo/base';
import SummaryListPage from '../SummaryListPage';

/**
 * 回归：#1461 后总结方式选择上移到列表页「+」下拉。
 * WKViewQueue 按数组下标渲染 pushed 视图（外层 div key={i}），右侧已有
 * SummaryCreatePage 时再次 push 同类型组件会命中 React 复用分支——组件不重挂载、
 * state.mode 不随新 initialMode 重读 → 点「Agent 总结」界面毫无反应。
 * 修复：push 的元素 key 绑定模式，模式变化即视为一次全新创建（强制重挂载）。
 */
describe('SummaryListPage mode entry navigation', () => {
    beforeEach(() => vi.clearAllMocks());

    function makePage() {
        const page = new SummaryListPage({} as any);
        (page as any).isMounted_ = true;
        return page;
    }

    it('pushes the create page keyed by mode so switching modes remounts instead of being silently reused', () => {
        const page = makePage();
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');
        const popToRootSpy = vi.spyOn(WKApp.routeRight, 'popToRoot');

        (page as any).handleCreate('normal');
        expect(pushSpy).toHaveBeenCalledTimes(1);
        expect(popToRootSpy).toHaveBeenCalledTimes(1);
        const normalEl = pushSpy.mock.calls[0][0] as React.ReactElement;
        expect(React.isValidElement(normalEl)).toBe(true);
        expect(normalEl.key).toBe('normal');
        expect(normalEl.props.initialMode).toBe('normal');

        // 再次选择 Agent：必须 push 一个 key 不同的新元素（key 相同会被 React 复用，
        // state.mode 保持 normal —— 正是线上「点了没反应」的根因）。
        (page as any).handleCreate('agent');
        expect(pushSpy).toHaveBeenCalledTimes(2);
        const agentEl = pushSpy.mock.calls[1][0] as React.ReactElement;
        expect(agentEl.key).toBe('agent');
        expect(agentEl.props.initialMode).toBe('agent');
        expect(agentEl.key).not.toBe(normalEl.key);
    });

    it('default (no-arg) entry still lands on the normal-mode create page', () => {
        const page = makePage();
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        (page as any).handleCreate();
        const el = pushSpy.mock.calls[0][0] as React.ReactElement;
        expect(el.key).toBe('normal');
        expect(el.props.initialMode).toBe('normal');
    });

    it('panel mode forwards the selected mode to the host via onCreateNew instead of pushing a route', () => {
        const onCreateNew = vi.fn();
        const page = new SummaryListPage({ onCreateNew } as any);
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        (page as any).handleCreate('agent');
        expect(onCreateNew).toHaveBeenCalledWith('agent');
        expect(pushSpy).not.toHaveBeenCalled();
    });
});
