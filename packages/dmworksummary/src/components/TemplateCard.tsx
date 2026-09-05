import React from 'react';
import { FileText, ListChecks, Calendar, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { TopicTemplate } from '../types/summary';

const ICON_MAP: Record<string, React.FC<{ size?: number }>> = {
    FileText,
    ListChecks,
    Calendar,
    MessageSquare,
};

type TemplateTone = 'blue' | 'purple' | 'orange' | 'cyan';

const TEMPLATE_TONES: Record<string, TemplateTone> = {
    project_progress: 'blue',
    task_tracking: 'blue',
    okr_alignment: 'blue',
    weekly_report: 'purple',
    personal_weekly_report: 'purple',
    todo_extraction: 'orange',
    chat_content: 'cyan',
    feedback_triage: 'cyan',
};

function resolveTemplateTone(template: TopicTemplate): TemplateTone {
    if (template.is_custom) return 'purple';
    if (TEMPLATE_TONES[template.id]) return TEMPLATE_TONES[template.id];
    if (template.icon === 'Calendar') return 'purple';
    if (template.icon === 'MessageSquare') return 'cyan';
    if (template.icon === 'ListChecks') return 'orange';
    return 'blue';
}

interface TemplateCardProps {
    template: TopicTemplate;
    onClick: (template: TopicTemplate) => void;
    selected?: boolean;
    onEdit?: (template: TopicTemplate) => void;
    onDelete?: (template: TopicTemplate) => void;
    editLabel?: string;
    deleteLabel?: string;
}

const TemplateCard: React.FC<TemplateCardProps> = ({
    template,
    onClick,
    selected,
    onEdit,
    onDelete,
    editLabel,
    deleteLabel,
}) => {
    const IconComponent = ICON_MAP[template.icon] ?? FileText;
    const tone = resolveTemplateTone(template);

    return (
        <div
            className={`chat-summary-template-card${template.is_custom ? ' chat-summary-template-card-custom' : ''}`}
            data-template-tone={tone}
        >
            <button
                type="button"
                className="chat-summary-template-card-select"
                aria-label={template.label}
                aria-pressed={selected}
                onClick={() => onClick(template)}
            >
                <span className="chat-summary-template-card-content">
                    <span className="chat-summary-template-card-icon" aria-hidden="true">
                        <IconComponent size={18} />
                    </span>
                    <span className="chat-summary-template-card-copy">
                        <span className="chat-summary-template-card-title">{template.label}</span>
                        <span className="chat-summary-template-card-desc">{template.description}</span>
                    </span>
                </span>
            </button>
            {(onEdit || onDelete) && (
                <div className="chat-summary-template-actions">
                    {onEdit && (
                        <button
                            type="button"
                            className="chat-summary-template-edit"
                            onClick={() => onEdit(template)}
                            aria-label={editLabel}
                        >
                            <Pencil size={14} />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            className="chat-summary-template-delete"
                            onClick={() => onDelete(template)}
                            aria-label={deleteLabel}
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default TemplateCard;
