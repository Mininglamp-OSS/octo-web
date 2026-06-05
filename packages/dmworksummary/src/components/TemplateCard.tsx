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
}

const TemplateCard: React.FC<TemplateCardProps> = ({ template, onClick }) => {
    const IconComponent = ICON_MAP[template.icon];

    return (
        <div
            className="chat-summary-template-card"
            onClick={() => onClick(template)}
            style={{
                flex: '1 1 0',
                minWidth: 0,
                padding: '12px',
                border: '1px solid var(--wk-border-default, #E5E6EB)',
                borderRadius: 8,
                cursor: 'pointer',
                backgroundColor: 'var(--wk-bg-surface, #fff)',
                transition: 'background-color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#F0F7FF';
                e.currentTarget.style.borderColor = 'var(--wk-color-primary, #3370FF)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--wk-bg-surface, #fff)';
                e.currentTarget.style.borderColor = 'var(--wk-border-default, #E5E6EB)';
            }}
        >
            <div style={{ marginBottom: 8, color: 'var(--wk-text-secondary, #646A73)' }}>
                {IconComponent ? <IconComponent size={20} /> : null}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: 'var(--wk-text-primary, #1C1F23)' }}>
                {template.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--wk-text-tertiary, #8F959E)', lineHeight: '16px' }}>
                {template.description}
            </div>
        </div>
    );
};

export default TemplateCard;
