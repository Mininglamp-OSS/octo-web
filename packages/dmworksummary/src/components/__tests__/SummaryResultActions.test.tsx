import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// 本包既有约定（参考 ChatSummaryStarButton.test.tsx）：单测里必须 mock 掉 semi-ui barrel。
// 它会把 @tiptap/react 拉进 import 图，而 tiptap 在本仓的 React 17 dedupe 环境下
// 解析不到 react/jsx-runtime，直接打断整个套件的 collection。
vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, loading, onClick, icon }: any) => (
        <button className={loading ? 'semi-button loading' : 'semi-button'} onClick={onClick}>
            {icon}
            {children}
        </button>
    ),
}));

vi.mock('lucide-react', () => ({
    Copy: () => <svg data-testid="copy-icon" />,
    FileText: () => <svg data-testid="filetext-icon" />,
}));

import SummaryResultActions from '../SummaryResultActions';
// 这四个是 `src/__mocks__/dmworkBase.ts` 里的测试专用开关（vitest 把 `@octo/base`
// alias 到那个 mock），真实包里不存在，所以走 mock 路径导入以免 tsc 报找不到导出。
import { __setDocsOn, __setDocsConvertHandler, __resetDocsPort, __fireConfigChangeListeners } from '../../__mocks__/dmworkBase';

/**
 * 「复制 / 转为在线文档」操作行的可见性契约（octo-smart-summary#195）。
 *
 * 这些用例锁住三条 CR 结论：
 *  1. 内容为空 → 整行不渲染（否则用户点了没反应，handler 里静默 return）；
 *  2. docs 能力不可用 → 只剩复制，不渲染必然失败的转文档按钮；
 *  3. 回调拿到的是本行自己的内容，且 loading 由本行独立控制。
 */
describe('SummaryResultActions', () => {
    beforeEach(() => {
        __resetDocsPort();
        __setDocsOn(true);
        __setDocsConvertHandler(async () => ({ docId: 'd1', url: '/d/d1' }));
    });

    afterEach(() => {
        cleanup();
        __resetDocsPort();
    });

    const noop = () => {};

    it('内容为空时整行不渲染', () => {
        const { container } = render(
            <SummaryResultActions content="" onCopy={noop} onConvert={noop} />,
        );
        expect(container.querySelector('.summary-detail-result-actions')).toBeNull();
    });

    it('内容只有空白时整行不渲染（避免死按钮）', () => {
        const { container } = render(
            <SummaryResultActions content={'   \n  \t '} onCopy={noop} onConvert={noop} />,
        );
        expect(container.querySelector('.summary-detail-result-actions')).toBeNull();
    });

    it('content 为 undefined 时整行不渲染', () => {
        const { container } = render(
            <SummaryResultActions content={undefined} onCopy={noop} onConvert={noop} />,
        );
        expect(container.querySelector('.summary-detail-result-actions')).toBeNull();
    });

    it('docs 能力可用时渲染复制 + 转文档两个按钮', () => {
        render(<SummaryResultActions content="hello" onCopy={noop} onConvert={noop} />);
        expect(screen.getByText('复制')).toBeTruthy();
        expect(screen.getByText('转为在线文档')).toBeTruthy();
    });

    it('docsOn 关闭时只渲染复制按钮（转文档必然失败，不该出现）', () => {
        __setDocsOn(false);
        render(<SummaryResultActions content="hello" onCopy={noop} onConvert={noop} />);
        expect(screen.getByText('复制')).toBeTruthy();
        expect(screen.queryByText('转为在线文档')).toBeNull();
    });

    it('docs 端口未注册时只渲染复制按钮（纯 OSS bundle 无 docs 模块）', () => {
        __setDocsConvertHandler(null);
        render(<SummaryResultActions content="hello" onCopy={noop} onConvert={noop} />);
        expect(screen.getByText('复制')).toBeTruthy();
        expect(screen.queryByText('转为在线文档')).toBeNull();
    });

    it('点击复制时把本行的内容回传给 onCopy', () => {
        const onCopy = vi.fn();
        render(<SummaryResultActions content="my own content" onCopy={onCopy} onConvert={noop} />);
        fireEvent.click(screen.getByText('复制'));
        expect(onCopy).toHaveBeenCalledWith('my own content');
    });

    it('点击转文档时把本行的内容和标题回传给 onConvert', () => {
        const onConvert = vi.fn();
        render(
            <SummaryResultActions
                content="my own content"
                title="我的周报"
                onCopy={noop}
                onConvert={onConvert}
            />,
        );
        fireEvent.click(screen.getByText('转为在线文档'));
        expect(onConvert).toHaveBeenCalledWith('my own content', '我的周报');
    });

    it('支持自定义文案 key', () => {
        render(
            <SummaryResultActions
                content="x"
                copyLabelKey="summary.detail.copySuccess"
                onCopy={noop}
                onConvert={noop}
            />,
        );
        expect(screen.getByText('已复制到剪贴板')).toBeTruthy();
    });

    it('loading 由本行独立控制：copying 只影响复制按钮', () => {
        const { container } = render(
            <SummaryResultActions content="x" copying onCopy={noop} onConvert={noop} />,
        );
        const buttons = container.querySelectorAll('button');
        // 第一个是复制，处于 loading；第二个是转文档，不受影响。
        expect(buttons[0].className).toMatch(/loading/);
        expect(buttons[1].className).not.toMatch(/loading/);
    });

    it('docsOn 运行期翻转时跟随 config change 广播刷新（round-4 P2-a）', () => {
        // 先以 docsOn=false 挂载：按钮集合里只有复制。
        __setDocsOn(false);
        render(<SummaryResultActions content="hello" onCopy={noop} onConvert={noop} />);
        expect(screen.queryByText('转为在线文档')).toBeNull();

        // appconfig 到位 / docs_on 翻转为 true → 广播 → 转文档按钮补位。
        __setDocsOn(true);
        act(() => { __fireConfigChangeListeners(); });
        expect(screen.getByText('转为在线文档')).toBeTruthy();

        // 再翻回 false → 按钮撤掉，且组件没有留在旧状态。
        __setDocsOn(false);
        act(() => { __fireConfigChangeListeners(); });
        expect(screen.queryByText('转为在线文档')).toBeNull();
    });
});
