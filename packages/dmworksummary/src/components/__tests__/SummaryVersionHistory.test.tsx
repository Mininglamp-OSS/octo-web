import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SummaryVersionHistory from '../SummaryVersionHistory';
import type { SummaryVersionItem } from '../../types/summary';

vi.mock('@octo/base', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../__mocks__/dmworkBase');
    return {
        ...actual,
        useI18n: () => ({
            t: (key: string, opts?: { values?: Record<string, string | number> }) => {
                const map: Record<string, string> = {
                    'summary.detail.recentVersions': '最近版本',
                    'summary.detail.recentVersionsLimitHint': '仅展示最近 3 个版本',
                    'summary.detail.currentVersion': '当前版本',
                    'summary.detail.versionScheduledTaskTag': '定时任务',
                    'summary.detail.viewVersion': '查看',
                    'summary.detail.restoreVersion': '恢复此版本',
                    'summary.detail.versionInitialGenerate': '初始生成',
                    'summary.detail.versionInitialGenerateDesc': '第一次生成的基线版本，可用于恢复到微调前内容。',
                    'summary.detail.versionRestoreFromResult': '恢复自历史结果 #{{id}}',
                    'summary.detail.versionOperation.generate': '初始生成',
                    'summary.detail.versionOperation.regenerate': '重新生成',
                    'summary.detail.versionOperation.scheduled_generate': '定时生成',
                    'summary.detail.versionOperation.refine': '按意见调整',
                    'summary.detail.versionOperation.manual_edit': '手动编辑',
                    'summary.detail.versionOperation.restore': '恢复版本',
                    'summary.common.version': '版本 {{version}}',
                };
                let result = map[key] ?? key;
                if (opts?.values) {
                    for (const [k, v] of Object.entries(opts.values)) {
                        result = result.replace(`{{${k}}}`, String(v));
                    }
                }
                return result;
            },
        }),
    };
});

vi.mock('@douyinfe/semi-ui', () => ({
    Button: ({ children, onClick, loading }: any) => (
        <button onClick={onClick} disabled={loading} data-testid="semi-button">
            {children}
        </button>
    ),
    Tag: ({ children, color }: any) => (
        <span data-testid="semi-tag" data-color={color}>{children}</span>
    ),
}));

vi.mock('@douyinfe/semi-icons', () => ({
    IconHistory: () => <span data-testid="icon-history" />,
}));

const noop = vi.fn();
const baseProps = {
    versionsLoading: false,
    currentVersion: 3,
    restoringVersionId: null,
    canRestore: true,
    onViewVersion: noop,
    onRestoreVersion: noop,
};

describe('SummaryVersionHistory', () => {
    it('returns null when versions list has <= 1 item', () => {
        const { container } = render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[{ result_id: 1, version: 1, operation_type: 'generate', generated_at: '2026-07-17' }]}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('returns null when loading', () => {
        const { container } = render(
            <SummaryVersionHistory
                {...baseProps}
                versionsLoading={true}
                versions={[]}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders strip with title and hint when versions >= 2', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        expect(screen.getByText('最近版本')).toBeTruthy();
        expect(screen.getByText('仅展示最近 3 个版本')).toBeTruthy();
    });

    it('shows current version tag for the current version', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                currentVersion={3}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        const tags = screen.getAllByTestId('semi-tag');
        expect(tags.some(t => t.textContent === '当前版本')).toBe(true);
    });

    it('shows scheduled_generate tag for scheduled versions', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 1, version: 1, operation_type: 'scheduled_generate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        const tags = screen.getAllByTestId('semi-tag');
        expect(tags.some(t => t.textContent === '定时任务')).toBe(true);
    });

    it('shows restore button only for non-current versions when canRestore', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                currentVersion={3}
                canRestore={true}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        const buttons = screen.getAllByTestId('semi-button');
        const restoreButtons = buttons.filter(b => b.textContent === '恢复此版本');
        expect(restoreButtons).toHaveLength(1);
    });

    it('hides restore buttons when canRestore is false', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                canRestore={false}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        const buttons = screen.getAllByTestId('semi-button');
        const restoreButtons = buttons.filter(b => b.textContent === '恢复此版本');
        expect(restoreButtons).toHaveLength(0);
    });

    // ─── Note fallback chain (the regression that was fixed) ───

    it('shows operation_note when present', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', operation_note: '人工微调措辞', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        expect(screen.getByText('人工微调措辞')).toBeTruthy();
    });

    it('shows versionInitialGenerateDesc fallback for generate type without operation_note', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 1, version: 1, operation_type: 'generate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        expect(screen.getByText('第一次生成的基线版本，可用于恢复到微调前内容。')).toBeTruthy();
    });

    it('shows versionRestoreFromResult fallback for restore type with parent_result_id', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'restore', parent_result_id: 42, generated_at: '2026-07-16' },
                ]}
            />,
        );
        expect(screen.getByText('恢复自历史结果 #42')).toBeTruthy();
    });

    it('shows operation label fallback for other types without operation_note', () => {
        render(
            <SummaryVersionHistory
                {...baseProps}
                versions={[
                    { result_id: 3, version: 3, operation_type: 'manual_edit', generated_at: '2026-07-17' },
                    { result_id: 2, version: 2, operation_type: 'regenerate', generated_at: '2026-07-16' },
                ]}
            />,
        );
        // regenerate type without note should fall back to the operation label
        expect(screen.getByText('重新生成')).toBeTruthy();
    });
});
