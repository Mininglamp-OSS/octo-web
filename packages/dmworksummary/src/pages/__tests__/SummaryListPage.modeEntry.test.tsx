import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return { ...actual };
});
vi.mock('@douyinfe/semi-ui', () => ({
    Button: () => null,
    Dropdown: Object.assign(
        ({ children, render }: any) => (
            <div data-testid="dropdown">
                {children}
                <div data-testid="dropdown-menu">{typeof render === 'function' ? render() : render}</div>
            </div>
        ),
        {
            Menu: ({ children }: any) => <div data-testid="dropdown-menu-list">{children}</div>,
            Item: ({ children, onClick, active }: any) => (
                <button data-testid="dropdown-item" data-active={active} onClick={onClick}>
                    {children}
                </button>
            ),
        },
    ),
    Spin: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
    Banner: () => null,
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
vi.mock('../../features/summaryWorkbench/SummaryWorkbenchCreateEntry', () => ({
    default: () => null,
}));
vi.mock('../SummaryCreatePage', () => ({ default: () => null }));
vi.mock('../SummaryDetailPage', () => ({ default: () => null }));
vi.mock('../../api/summaryApi');

import { WKApp } from '@octo/base';
import SummaryWorkbenchEntry from '../../features/summaryWorkbench/Entry';
import SummaryWorkbenchCreateEntry from '../../features/summaryWorkbench/SummaryWorkbenchCreateEntry';
import SummaryListPage from '../SummaryListPage';

/** 递归遍历 React 元素树，收集满足条件的节点（不依赖 @testing-library）。 */
function findInTree(node: unknown, predicate: (n: any) => boolean, out: any[] = []): any[] {
    if (!node || typeof node !== 'object') return out;
    if (predicate(node)) out.push(node);
    const children = (node as any).props?.children;
    if (children != null) {
        const kids = Array.isArray(children) ? children : [children];
        for (const c of kids) findInTree(c, predicate, out);
    }
    return out;
}

function findOne(node: unknown, predicate: (n: any) => boolean): any {
    const hits = findInTree(node, predicate);
    expect(hits.length).toBe(1);
    return hits[0];
}

/**
 * 回归：#1461 后总结方式选择上移到列表页「+」下拉。
 * WKViewQueue 按数组下标渲染 pushed 视图（外层 div key={i}），push 的元素若与
 * 旧栈同类型同 key 会命中 React 复用分支——组件不重挂载、state 不随新 initialMode
 * 重读 → 点「Agent 总结」界面毫无反应。
 * #1484 评审 P2-1：key 只按 mode 时，连续两次选同模式（如 NavRail 默认创建页上
 * 再点「+ → 快速总结」）同样命中复用分支。修复：key 绑定「模式 + 每次新建序号」，
 * 每次选择都强制全新挂载。
 */
describe('SummaryListPage mode entry navigation', () => {
    beforeEach(() => vi.clearAllMocks());

    function makePage(props: Record<string, unknown> = {}) {
        const page = new SummaryListPage(props as any);
        (page as any).isMounted_ = true;
        return page;
    }

    function renderEntryBranch(
        page: SummaryListPage,
        mode: 'pending' | 'unified' | 'legacy',
    ) {
        const gate = (page as any).render() as React.ReactElement;
        expect(gate.type).toBe(SummaryWorkbenchEntry);
        expect(gate.props.spaceId).toBe('space-123');
        if (mode === 'pending') {
            return gate.props.renderPending({
                status: 'loading',
                enabled: false,
                spaceId: 'space-123',
            });
        }
        if (mode === 'unified') {
            return gate.props.renderNew({
                status: 'enabled',
                enabled: true,
                spaceId: 'space-123',
                reason: 'supported',
                contractVersion: '2',
                checkedAt: 1,
            });
        }
        return gate.props.renderLegacy({
            status: 'disabled',
            enabled: false,
            spaceId: 'space-123',
            reason: 'server_disabled',
            checkedAt: 1,
        });
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
        expect(String(normalEl.key).startsWith('normal-')).toBe(true);
        expect(normalEl.props.initialMode).toBe('normal');

        // 再次选择 Agent：必须 push 一个 key 不同的新元素（key 相同会被 React 复用，
        // state.mode 保持 normal —— 正是线上「点了没反应」的根因）。
        (page as any).handleCreate('agent');
        expect(pushSpy).toHaveBeenCalledTimes(2);
        const agentEl = pushSpy.mock.calls[1][0] as React.ReactElement;
        expect(String(agentEl.key).startsWith('agent-')).toBe(true);
        expect(agentEl.props.initialMode).toBe('agent');
        expect(agentEl.key).not.toBe(normalEl.key);
    });

    it('P2-1: two consecutive picks of the SAME mode get distinct keys (no silent reuse)', () => {
        const page = makePage();
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        (page as any).handleCreate('normal');
        (page as any).handleCreate('normal');
        expect(pushSpy).toHaveBeenCalledTimes(2);
        const first = pushSpy.mock.calls[0][0] as React.ReactElement;
        const second = pushSpy.mock.calls[1][0] as React.ReactElement;
        expect(first.key).not.toBe(second.key);
        expect(first.props.initialMode).toBe('normal');
        expect(second.props.initialMode).toBe('normal');
    });

    it('default (no-arg) entry still lands on the normal-mode create page', () => {
        const page = makePage();
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        (page as any).handleCreate();
        const el = pushSpy.mock.calls[0][0] as React.ReactElement;
        expect(String(el.key).startsWith('normal-')).toBe(true);
        expect(el.props.initialMode).toBe('normal');
    });

    it('panel mode forwards the selected mode to the host via onCreateNew instead of pushing a route', () => {
        const onCreateNew = vi.fn();
        const page = makePage({ onCreateNew });
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        (page as any).handleCreate('agent');
        expect(onCreateNew).toHaveBeenCalledWith('agent');
        expect(pushSpy).not.toHaveBeenCalled();
    });

    it('capability-enabled entry pushes the unified workbench without exposing a mode choice', () => {
        const page = makePage();
        (page as any).context = { locale: 'zh-CN', t: (k: string) => k };
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        const tree = renderEntryBranch(page, 'unified');
        const trigger = findOne(
            tree,
            (n) => n?.props?.['data-testid'] === 'summary-list-mode-switch',
        );
        expect(trigger.props.disabled).toBe(false);
        expect(trigger.props.onClick).toBe((page as any).handleUnifiedCreate);
        expect(findInTree(
            tree,
            (n) => n?.props?.['data-testid'] === 'summary-list-normal-tab',
        )).toHaveLength(0);
        expect(findInTree(
            tree,
            (n) => n?.props?.['data-testid'] === 'summary-list-agent-tab',
        )).toHaveLength(0);

        trigger.props.onClick();
        expect(pushSpy).toHaveBeenCalledTimes(1);
        const entry = pushSpy.mock.calls[0][0] as React.ReactElement;
        expect(entry.type).toBe(SummaryWorkbenchCreateEntry);
        expect(String(entry.key).startsWith('unified-')).toBe(true);
        expect(entry.props.source).toBe('summary_list');
    });

    it('panel mode forwards unified entry selection to its host', () => {
        const onCreateNew = vi.fn();
        const page = makePage({ onCreateNew });

        (page as any).handleUnifiedCreate();

        expect(onCreateNew).toHaveBeenCalledWith('unified');
    });

    it('opens Agent continue optimization with the selected summary as reference', () => {
        const page = makePage();
        const task = { task_id: 42, title: 'Agent summary' };
        (page as any).state = { ...(page as any).state, items: [task] };
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        (page as any).handleContinueOptimize(42);

        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('summary-open-chat-with-reference');
        expect(event.detail).toBe(task);
    });

    it('delegates Agent continue optimization to the panel host when provided', () => {
        const onContinueOptimize = vi.fn();
        const page = makePage({ onContinueOptimize });
        const task = { task_id: 42, title: 'Agent summary' };
        (page as any).state = { ...(page as any).state, items: [task] };
        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');

        (page as any).handleContinueOptimize(42);

        expect(onContinueOptimize).toHaveBeenCalledWith(task);
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('fail-closed Legacy entry keeps normal and Agent choices in the original dropdown', () => {
        const page = makePage();
        (page as any).context = { locale: 'zh-CN', t: (k: string) => k };
        const pushSpy = vi.spyOn(WKApp.routeRight, 'push');

        const tree = renderEntryBranch(page, 'legacy');

        // 触发按钮：只有 data-testid/icon/aria-label，没有 onClick（点击只弹下拉）。
        const trigger = findOne(
            tree,
            (n) => n?.props?.['data-testid'] === 'summary-list-mode-switch',
        );
        expect(trigger.props.onClick).toBeUndefined();
        expect(pushSpy).not.toHaveBeenCalled();

        // 下拉菜单项才是模式入口：普通项与 Agent 项分别调 handleCreate 对应模式。
        // 注意：semi Dropdown 的 render prop 传的是元素（render={( <Menu/> )}），不是函数。
        const dropdowns = findInTree(
            tree,
            (n) => n?.props?.render && React.isValidElement(n.props.render),
        );
        const items = dropdowns.flatMap((dropdown) => findInTree(dropdown.props.render, (n) => n?.props?.onClick));
        const byTestId = (id: string) =>
            items.find((n) => n.props?.['data-testid'] === id) ?? null;
        expect(byTestId('summary-list-normal-tab')).not.toBeNull();
        expect(byTestId('summary-list-agent-tab')).not.toBeNull();

        byTestId('summary-list-agent-tab').props.onClick();
        expect(pushSpy).toHaveBeenCalledTimes(1);
        const el = pushSpy.mock.calls[0][0] as React.ReactElement;
        expect(el.props.initialMode).toBe('agent');

        byTestId('summary-list-normal-tab').props.onClick();
        expect(pushSpy).toHaveBeenCalledTimes(2);
        expect((pushSpy.mock.calls[1][0] as React.ReactElement).props.initialMode).toBe('normal');
    });

    it('keeps create controls disabled while capability availability is pending', () => {
        const page = makePage();
        (page as any).context = { locale: 'zh-CN', t: (k: string) => k };

        const tree = renderEntryBranch(page, 'pending');
        const trigger = findOne(
            tree,
            (n) => n?.props?.['data-testid'] === 'summary-list-mode-switch',
        );
        expect(trigger.props.disabled).toBe(true);
        expect(trigger.props.onClick).toBeUndefined();
    });
});
