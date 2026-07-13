import React from 'react';
import { FileText, ListChecks, Calendar, MessageSquare } from 'lucide-react';
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
            <div className="chat-summary-template-card-icon">
                <IconComponent size={20} />
            </div>
            <div className="chat-summary-template-card-title">
                {template.label}
            </div>
            <div className="chat-summary-template-card-desc">
                {template.description}
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
                            {editLabel}
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
                            {deleteLabel}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default TemplateCard;
