import React, { Component } from 'react';
import { Spin, Empty } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import SummaryContent from './SummaryContent';
import { getSummaryDetail, getPersonalResult } from '../api/summaryApi';
import type { SummaryDetail, PersonalResult } from '../types/summary';
import './SummaryReferenceSidePanel.css';

/**
 * 引用总结右侧对照面板 (CHAT-REFERENCE-PREVIEW-AND-RANGE-SAVE-v1 需求 1)
 *
 * 主要用途: 用户希望在 chat 修改总结时,一边看原总结,一边告诉 agent 改哪里。
 *          Modal 遮住 chat 无法对照 → 改成右侧 SidePanel。
 *
 * 交互:
 * - 点击引用卡片打开 (父组件 toggle sidePanelOpen)
 * - 点击面板右上角 × 关闭
 * - 切引用时: 父组件更新 taskId prop,面板内容跟着变
 * - 移除引用时: 父组件关闭面板
 *
 * 内容源(与 SummaryPreviewModal / SummaryDetailPage 一致的双源策略):
 * - 传统 workflow: getSummaryDetail(id).result.content (summary_result 表)
 * - Agent 生成:  getPersonalResult(id).content       (summary_personal_result 表)
 */

interface SummaryReferenceSidePanelProps {
    taskId: number | null;
    onClose: () => void;
}

interface SummaryReferenceSidePanelState {
    loading: boolean;
    detail: SummaryDetail | null;
    personalResult: PersonalResult | null;
    error: string | null;
}

class SummaryReferenceSidePanel extends Component<
    SummaryReferenceSidePanelProps,
    SummaryReferenceSidePanelState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryReferenceSidePanelState = {
        loading: false,
        detail: null,
        personalResult: null,
        error: null,
    };

    componentDidMount() {
        // 挂载时若已有 taskId (父组件初次渲染就传了) → 加载
        if (this.props.taskId != null) {
            void this.load(this.props.taskId);
        }
    }

    componentDidUpdate(prev: SummaryReferenceSidePanelProps) {
        // taskId 变了 (切引用 or 首次打开) → 重新加载
        if (this.props.taskId !== prev.taskId && this.props.taskId != null) {
            void this.load(this.props.taskId);
        }
        // taskId 从有 → null (父组件传的语义 = 关闭) → 清 state 避免残留
        if (this.props.taskId == null && prev.taskId != null) {
            this.setState({
                detail: null,
                personalResult: null,
                error: null,
                loading: false,
            });
        }
    }

    private load = async (taskId: number) => {
        const { t } = this.context;
        this.setState({ loading: true, detail: null, personalResult: null, error: null });
        try {
            const detail = await getSummaryDetail(taskId);
            const teamContent = detail?.result?.content || '';
            if (teamContent.trim()) {
                this.setState({ loading: false, detail, personalResult: null });
                return;
            }
            // team result 空 → fallback 到 caller 自己的 PR (agent 生成场景)
            try {
                const personal = await getPersonalResult(taskId);
                this.setState({ loading: false, detail, personalResult: personal });
            } catch (personalErr: any) {
                // PR 也没有 → 保留 detail (至少能显示标题),SummaryContent 显示 empty state
                this.setState({ loading: false, detail, personalResult: null });
            }
        } catch (e: any) {
            const httpStatus = e?.response?.status ?? e?.status;
            const msg =
                httpStatus === 404 || httpStatus === 403
                    ? t('summary.chatReference.previewNotFound')
                    : t('summary.chatReference.previewLoadFailed');
            this.setState({ loading: false, error: msg });
        }
    };

    render() {
        const { taskId, onClose } = this.props;
        const { loading, detail, personalResult, error } = this.state;
        const { t } = this.context;

        // 父组件 taskId=null 时不渲染 (由父组件条件挂载即可)
        if (taskId == null) return null;

        const title = detail?.title || t('summary.chatReference.previewTitle');
        const content = detail?.result?.content?.trim()
            ? detail.result.content
            : personalResult?.content || '';

        return (
            <div className="summary-workbench-ref-side">
                <div className="summary-workbench-ref-side-header">
                    <span className="summary-workbench-ref-side-title" title={title}>
                        {title}
                    </span>
                    <span
                        className="summary-workbench-ref-side-close"
                        onClick={onClose}
                        title={t('summary.chatReference.remove')}
                    >
                        ×
                    </span>
                </div>
                <div className="summary-workbench-ref-side-hint">
                    {t('summary.chatReference.previewLatestHint')}
                </div>
                <div className="summary-workbench-ref-side-body">
                    {loading && (
                        <div className="summary-workbench-ref-side-loading">
                            <Spin />
                        </div>
                    )}
                    {!loading && error && <Empty description={error} />}
                    {!loading && !error && detail && <SummaryContent content={content} />}
                </div>
            </div>
        );
    }
}

export default SummaryReferenceSidePanel;
