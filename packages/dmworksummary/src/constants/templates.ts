import type { LocalTopicTemplate } from '../types/summary';

/**
 * 前端离线兜底模板：存 i18n key（去 `summary.` 前缀），由 resolveTemplate 在
 * render() 期按当前 locale 解析为明文，保证切语言即时刷新。
 * key 层故意与后端模板 `id` 对齐（snake_case），便于按 id 拼接。
 */
export const TOPIC_TEMPLATES: LocalTopicTemplate[] = [
    {
        id: 'project_progress',
        icon: 'FileText',
        type: 'parameterized',
        labelKey: 'templates.project_progress.label',
        descriptionKey: 'templates.project_progress.description',
        patternKey: 'templates.project_progress.pattern',
        placeholders: [
            { key: 'project_name', labelKey: 'templates.project_progress.placeholder', position: [3, 9] },
        ],
    },
    {
        id: 'task_tracking',
        icon: 'ListChecks',
        type: 'parameterized',
        labelKey: 'templates.task_tracking.label',
        descriptionKey: 'templates.task_tracking.description',
        patternKey: 'templates.task_tracking.pattern',
        placeholders: [
            { key: 'task_name', labelKey: 'templates.task_tracking.placeholder', position: [3, 9] },
        ],
    },
    {
        id: 'weekly_report',
        icon: 'Calendar',
        type: 'fixed',
        labelKey: 'templates.weekly_report.label',
        descriptionKey: 'templates.weekly_report.description',
        patternKey: 'templates.weekly_report.pattern',
    },
    {
        id: 'chat_content',
        icon: 'MessageSquare',
        type: 'fixed',
        labelKey: 'templates.chat_content.label',
        descriptionKey: 'templates.chat_content.description',
        patternKey: 'templates.chat_content.pattern',
    },
];
