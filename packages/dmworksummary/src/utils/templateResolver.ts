import type {
    LocalTopicTemplate,
    TopicTemplate,
    TopicTemplatePlaceholder,
} from '../types/summary';

type TranslateFn = (key: string, options?: { values?: Record<string, unknown>; defaultValue?: string }) => string;

/** 解析期接受两态：前端兜底 LocalTopicTemplate（含 *Key）或后端明文 TopicTemplate。 */
export type ResolvableTemplate = LocalTopicTemplate | TopicTemplate;

export interface CustomTemplateSelectionLabels {
    topic: string;
    context: string;
}

export function getTemplateEditableFields(template: TopicTemplate): {
    label: string;
    description: string;
} {
    return {
        label: template.label,
        description: template.description,
    };
}

export function deriveSummaryTitle(topic: string): string {
    const trimmed = topic.trim();
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    const contentLine = lines.find((line) => /^(内容重点|总结内容|Content focus|Summary content)\s*[:：]/i.test(line));
    const source = contentLine || lines[0] || trimmed;
    const match = source.match(/^(内容重点|总结内容|总结主题|主题|Content focus|Summary content|Summary topic|Topic)\s*[:：]\s*(.+)$/i);
    return (match?.[2] || source).trim();
}

/** Keep template framing visible while limiting only the editable summary content. */
export function limitTemplateSummaryContent(topic: string, maxLength: number): string {
    const contentMatch = /(?:^|\n)(?:内容重点|总结内容|Content focus|Summary content)\s*[:：]\s*/i.exec(topic);
    if (!contentMatch) return topic.slice(0, maxLength);
    const contentStart = contentMatch.index + contentMatch[0].length;
    return topic.slice(0, contentStart) + topic.slice(contentStart).slice(0, maxLength);
}

/** 以 `labelKey` 是否存在判别是否为前端兜底（需解析 i18n key）类型。 */
function isLocalTemplate(template: ResolvableTemplate): template is LocalTopicTemplate {
    return typeof (template as LocalTopicTemplate).labelKey === 'string';
}

/**
 * 把模板解析为已本地化的明文 TopicTemplate。
 * - LocalTopicTemplate（含 *Key）：用 `summary.` 前缀的 key 经 `t` 解析为明文。
 * - 已是明文 TopicTemplate（无 *Key，来自后端或测试 inline mock）：原样透传。
 *
 * render() 里对 state 中的模板统一过一遍即可，调用方无需先分流。
 */
export function resolveTemplate(template: ResolvableTemplate, t: TranslateFn): TopicTemplate {
    if (!isLocalTemplate(template)) {
        return template;
    }
    const placeholders: TopicTemplatePlaceholder[] | undefined = template.placeholders?.map((ph) => ({
        key: ph.key,
        label: t(`summary.${ph.labelKey}`),
        position: ph.position,
    }));
    return {
        id: template.id,
        icon: template.icon,
        type: template.type,
        label: t(`summary.${template.labelKey}`),
        description: t(`summary.${template.descriptionKey}`),
        pattern: t(`summary.${template.patternKey}`),
        placeholders,
    };
}

/**
 * 基于已本地化的明文模板，生成填入输入框的文本与首个 placeholder 选区。
 * - text：把全部 placeholder 的 `{key}` token 依次替换成对应 label（与原 applyTemplate 一致），
 *   避免多 placeholder 模板残留未替换 token。
 * - range：在本地化 pattern 中定位首个 placeholder 的 token，得到 [tokenStart, tokenStart+label.length]；
 *   token 找不到时回退到 placeholder.position（后端老数据兜底），仍无则 null。
 */
export function computeTemplateSelection(template: TopicTemplate): {
    text: string;
    range: [number, number] | null;
};
export function computeTemplateSelection(
    template: TopicTemplate,
    customLabels: CustomTemplateSelectionLabels,
): {
    text: string;
    range: [number, number] | null;
};
export function computeTemplateSelection(
    template: TopicTemplate,
    customLabels?: CustomTemplateSelectionLabels,
): {
    text: string;
    range: [number, number] | null;
} {
    if (customLabels) {
        const parts = [
            template.label ? `${customLabels.topic}: ${template.label}` : '',
            template.description ? `${customLabels.context}: ${template.description}` : '',
        ];
        return { text: parts.filter(Boolean).join('\n'), range: null };
    }

    if (template.is_custom) {
        return { text: [template.label, template.description].filter(Boolean).join('\n'), range: null };
    }

    const pattern = template.pattern;
    const placeholders = template.placeholders ?? [];

    let text = pattern;
    for (const ph of placeholders) {
        text = text.replace(`{${ph.key}}`, ph.label);
    }

    if (template.type !== 'parameterized' || placeholders.length === 0) {
        return { text, range: null };
    }

    const first = placeholders[0];
    const tokenStart = pattern.indexOf(`{${first.key}}`);
    if (tokenStart !== -1) {
        return { text, range: [tokenStart, tokenStart + first.label.length] };
    }
    return { text, range: first.position ?? null };
}
