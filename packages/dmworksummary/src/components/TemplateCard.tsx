import React from 'react';
import { FileText, ListChecks, Calendar, MessageSquare, Pencil, Trash2 } from 'lucide-react';
import type { TopicTemplate } from '../types/summary';

const ICON_MAP: Record<string, React.FC<{ size?: number }>> = {
    FileText,
    ListChecks,
    Calendar,
    MessageSquare,
};

interface TemplateCardProps {
    template: TopicTemplate;
    onClick: (template: TopicTemplate) => void;
    onEdit?: (template: TopicTemplate) => void;
    onDelete?: (template: TopicTemplate) => void;
    editLabel?: string;
    deleteLabel?: string;
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onClick, onEdit, onDelete, editLabel, deleteLabel }) => {
    const IconComponent = ICON_MAP[template.icon] ?? FileText;

    return (
        <div
            className={`chat-summary-template-card${template.is_custom ? ' chat-summary-template-card-custom' : ''}`}
            onClick={() => onClick(template)}
        >
            <div className="chat-summary-template-card-content">
                <div className="chat-summary-template-card-header">
                    <span className="chat-summary-template-card-icon">
                        <IconComponent size={16} />
                    </span>
                    <span className="chat-summary-template-card-title">
                        {template.label}
                    </span>
                </div>
                <div className="chat-summary-template-card-desc">
                    {template.description}
                </div>
            </div>
            {(onEdit || onDelete) && (
                <div className="chat-summary-template-actions">
                    {onEdit && (
                        <button
                            type="button"
                            className="chat-summary-template-edit"
                            onClick={(e) => {
                                e.stopPropagation();
                                onEdit(template);
                            }}
                            aria-label={editLabel}
                        >
                            <Pencil size={14} />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            className="chat-summary-template-delete"
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete(template);
                            }}
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
