import { describe, it, expect } from 'vitest';
import { resolveTemplate, computeTemplateSelection, getTemplateEditableFields, deriveSummaryTitle, limitTemplateSummaryContent } from '../templateResolver';
import type { TopicTemplate } from '../../types/summary';
import { TOPIC_TEMPLATES } from '../../constants/templates';

// 读 zh-CN 资源的简易 t（与 dmworkBase mock 行为一致）：把 `summary.<path>` 映射到明文。
import zhCN from '../../i18n/zh-CN.json';
import enUS from '../../i18n/en-US.json';

type MessageNode = string | { [key: string]: MessageNode };

function flatten(messages: Record<string, MessageNode>, prefix = ''): Record<string, string> {
    return Object.entries(messages).reduce<Record<string, string>>((acc, [key, value]) => {
        const nextKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') acc[nextKey] = value;
        else Object.assign(acc, flatten(value, nextKey));
        return acc;
    }, {});
}

function makeT(locale: 'zh-CN' | 'en-US') {
    const source = locale === 'zh-CN' ? zhCN : enUS;
    const messages = Object.entries(flatten(source as Record<string, MessageNode>)).reduce<Record<string, string>>(
        (acc, [key, value]) => {
            acc[`summary.${key}`] = value;
            return acc;
        },
        {},
    );
    return (key: string, options?: { values?: Record<string, unknown>; defaultValue?: string }) =>
        messages[key] ?? options?.defaultValue ?? key;
}

describe('resolveTemplate', () => {
    it('resolves every built-in template id to non-key cleartext (zh-CN)', () => {
        const t = makeT('zh-CN');
        for (const tpl of TOPIC_TEMPLATES) {
            const resolved = resolveTemplate(tpl, t);
            // 解析结果必须是明文，而非回显 key（拼接 key 不被 i18n:check 收集，这里兜底）。
            expect(resolved.label.startsWith('templates.')).toBe(false);
            expect(resolved.label).not.toContain('.label');
            expect(resolved.description).not.toContain('.description');
            expect(resolved.pattern).not.toContain('.pattern');
            for (const ph of resolved.placeholders ?? []) {
                expect(ph.label).not.toContain('.placeholder');
            }
        }
    });

    it('resolves to localized English text (en-US)', () => {
        const t = makeT('en-US');
        const project = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'project_progress')!,
            t,
        );
        expect(project.label).toBe('Summarize project progress');
        expect(project.pattern).toBe('Summarize current project progress by completed work, in-progress work, risks/blockers, and next steps');
        expect(project.placeholders).toBeUndefined();
    });

    it('passes through already-cleartext backend templates unchanged', () => {
        const backend: TopicTemplate = {
            id: 'project_progress',
            label: '后端明文标题',
            icon: 'FileText',
            description: '后端明文描述',
            type: 'parameterized',
            pattern: '总结 {project_name} 的项目进展',
            placeholders: [{ key: 'project_name', label: '项目', position: [3, 9] }],
        };
        const resolved = resolveTemplate(backend, makeT('en-US'));
        expect(resolved).toBe(backend);
    });
});


describe('getTemplateEditableFields', () => {
    it('uses label and description for editing instead of the parameterized pattern', () => {
        const t = makeT('zh-CN');
        const resolved = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'task_tracking')!,
            t,
        );

        expect(getTemplateEditableFields(resolved)).toEqual({
            label: '跟踪任务进度',
            description: '总结任务完成情况，按任务、负责人、当前状态、待办事项整理',
        });
        expect(getTemplateEditableFields(resolved).description).not.toContain('{task_name}');
    });
});


describe('deriveSummaryTitle', () => {
    it('prefers the content focus line even when it is not first', () => {
        expect(deriveSummaryTitle('总结主题: 风险复盘\n内容重点: 按风险点整理')).toBe('按风险点整理');
    });

    it('supports fullwidth separators', () => {
        expect(deriveSummaryTitle('总结主题：任务划分\n内容重点：总结任务进度')).toBe('总结任务进度');
    });

    it('falls back to the first non-empty line without a known label', () => {
        expect(deriveSummaryTitle('  总结最近一周的工作  \n内容可以详细一点')).toBe('总结最近一周的工作');
    });

    it('returns an empty string for empty input', () => {
        expect(deriveSummaryTitle('   ')).toBe('');
    });
});

describe('limitTemplateSummaryContent', () => {
    it('preserves framing and limits only the summary content', () => {
        const framing = '总结主题: 周报\n内容重点: ';
        expect(limitTemplateSummaryContent(framing + '总'.repeat(2001), 2000))
            .toBe(framing + '总'.repeat(2000));
    });
});

describe('computeTemplateSelection', () => {
    it('locates the placeholder token for legacy parameterized templates', () => {
        const legacy: TopicTemplate = {
            id: 'legacy_project_progress',
            label: '汇总项目进展',
            icon: 'FileText',
            description: '与团队成员一起总结进展',
            type: 'parameterized',
            pattern: '总结 {project_name} 的项目进展',
            placeholders: [{ key: 'project_name', label: '输入项目名称', position: [3, 9] }],
        };
        const { text, range } = computeTemplateSelection(legacy);
        expect(text).toBe('总结 输入项目名称 的项目进展');
        expect(range).toEqual([3, 9]);
    });

    it('returns null range for fixed templates and replaces no token', () => {
        const t = makeT('zh-CN');
        const resolved = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'weekly_report')!,
            t,
        );
        const { text, range } = computeTemplateSelection(resolved);
        expect(text).toBe('总结团队成员每周工作，按成员、重点进展、成果产出、风险问题、下周计划整理');
        expect(range).toBeNull();
    });

    it('replaces all placeholder tokens (no residual {key}) for multi-placeholder patterns', () => {
        const multi: TopicTemplate = {
            id: 'multi',
            label: 'x',
            icon: 'FileText',
            description: 'x',
            type: 'parameterized',
            pattern: '{a} 和 {b}',
            placeholders: [
                { key: 'a', label: 'AA' },
                { key: 'b', label: 'BB' },
            ],
        };
        const { text, range } = computeTemplateSelection(multi);
        expect(text).toBe('AA 和 BB');
        expect(range).toEqual([0, 2]);
    });

    it('combines template label and description into the topic text', () => {
        const custom: TopicTemplate = {
            id: 'custom_task',
            label: '任务划分总结',
            icon: 'FileText',
            description: '每个任务都是谁负责，什么进度',
            type: 'fixed',
            pattern: '表格形式',
            is_custom: true,
        };

        const { text, range } = computeTemplateSelection(custom, {
            topic: '总结主题',
            context: '内容重点',
        });

        expect(text).toBe('总结主题: 任务划分总结\n内容重点: 每个任务都是谁负责，什么进度');
        expect(range).toBeNull();
    });

});
