import React from 'react';
import { Button, TextArea, Toast } from '@douyinfe/semi-ui';
import { useI18n } from '@wk/i18n';
import * as api from '../api/summaryApi';
import type { SummaryDetail } from '../types/summary';
import { WKApp } from '@wk/client';

interface RefineSectionProps {
    detail: SummaryDetail;
    onRefineSuccess: (newContent: string, newVersion: number, citations?: any[]) => void;
}

/**
 * Agent 总结反馈修改输入框（需求2 P2）
 * 
 * 显示条件（三重）:
 * 1. status === Completed (3)
 * 2. trigger_type === 'agent' (3)
 * 3. creator_id === 当前登录用户 uid
 */
export const RefineSection: React.FC<RefineSectionProps> = ({ detail, onRefineSuccess }) => {
    const { t } = useI18n();
    const [instruction, setInstruction] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);

    // 三重显示条件检查
    if (
        !detail ||
        detail.status !== 3 ||
        detail.trigger_type !== 3 ||
        detail.creator_id !== WKApp.loginInfo.uid
    ) {
        return null;
    }

    const charLimit = 1000;
    const charCount = instruction.length;

    const handleSubmit = async () => {
        const trimmed = instruction.trim();
        
        if (!trimmed) {
            Toast.warning(t('summary.detail.refinePlaceholder'));
            return;
        }
        if (trimmed.length > charLimit) {
            Toast.warning(t('common.charLimitReached', { values: { count: charLimit } }));
            return;
        }

        setSubmitting(true);

        try {
            const result = await api.refineAgentSummary(detail.task_id, trimmed);
            
            setInstruction('');
            setSubmitting(false);
            
            onRefineSuccess(result.content, result.new_version, result.citations);
            
            Toast.success(t('summary.detail.refineSuccess', { values: { version: result.new_version } }));
        } catch (err: unknown) {
            setSubmitting(false);
            const msg = err instanceof Error ? err.message : String(err);

            if (msg.includes('40001') || msg.includes('不支持')) {
                Toast.error(t('summary.detail.refineNotSupported'));
            } else if (msg.includes('40002') || msg.includes('创建者')) {
                Toast.error(t('summary.detail.refineNotCreator'));
            } else if (msg.includes('40004') || msg.includes('快照')) {
                Toast.error(t('summary.detail.refineNoSnapshot'));
            } else {
                Toast.error(t('summary.detail.refineFailed'));
            }
        }
    };

    return (
        <div
            className="summary-detail-refine"
            style={{
                marginTop: 'var(--semi-spacing-base)',
                padding: 'var(--semi-spacing-base)',
                borderRadius: 'var(--semi-border-radius-medium)',
                backgroundColor: 'var(--semi-color-fill-0)',
            }}
        >
            <h4
                style={{
                    marginBottom: 'var(--semi-spacing-tight)',
                    fontSize: 14,
                    fontWeight: 500,
                }}
            >
                {t('summary.detail.refineTitle')}
            </h4>
            <TextArea
                placeholder={t('summary.detail.refinePlaceholder')}
                value={instruction}
                onChange={(value) => setInstruction(value.slice(0, charLimit))}
                autosize={{ minRows: 3, maxRows: 8 }}
                disabled={submitting}
                style={{ marginBottom: 'var(--semi-spacing-tight)' }}
            />
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <span
                    style={{
                        fontSize: 12,
                        color:
                            charCount > charLimit * 0.9
                                ? 'var(--semi-color-warning)'
                                : 'var(--semi-color-text-2)',
                    }}
                >
                    {charCount} / {charLimit}
                </span>
                <Button
                    theme="solid"
                    onClick={handleSubmit}
                    loading={submitting}
                    disabled={submitting || !instruction.trim()}
                >
                    {t('summary.detail.refineSubmit')}
                </Button>
            </div>
        </div>
    );
};
