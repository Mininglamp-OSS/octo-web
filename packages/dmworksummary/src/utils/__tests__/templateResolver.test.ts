import { describe, it, expect } from 'vitest';
import { resolveTemplate, computeTemplateSelection } from '../templateResolver';
import { TOPIC_TEMPLATES } from '../../constants/templates';
import type { TopicTemplate } from '../../types/summary';

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
        expect(project.pattern).toBe('Summarize the progress of {project_name}');
        expect(project.placeholders?.[0].label).toBe('Enter project name');
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

describe('computeTemplateSelection', () => {
    it('locates the placeholder token in the zh-CN pattern → [3, 9]', () => {
        const t = makeT('zh-CN');
        const resolved = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'project_progress')!,
            t,
        );
        const { text, range } = computeTemplateSelection(resolved);
        expect(text).toBe('总结 输入项目名称 的项目进展');
        expect(range).toEqual([3, 9]);
    });

    it('locates the placeholder token in the en-US pattern → [26, 44]', () => {
        const t = makeT('en-US');
        const resolved = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'project_progress')!,
            t,
        );
        const { text, range } = computeTemplateSelection(resolved);
        expect(text).toBe('Summarize the progress of Enter project name');
        expect(range).toEqual([26, 44]);
    });

    it('returns null range for fixed templates and replaces no token', () => {
        const t = makeT('zh-CN');
        const resolved = resolveTemplate(
            TOPIC_TEMPLATES.find((x) => x.id === 'weekly_report')!,
            t,
        );
        const { text, range } = computeTemplateSelection(resolved);
        expect(text).toBe('总结每周的工作周报');
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
});
