import React, { Component } from 'react';
import { Modal, Spin, Empty } from '@douyinfe/semi-ui';
import { I18nContext } from '@octo/base';
import SummaryContent from './SummaryContent';
import { getSummaryDetail, getPersonalResult } from '../api/summaryApi';
import type { SummaryDetail, PersonalResult } from '../types/summary';
import './SummaryPreviewModal.css';

/**
 * 引用总结预览 Modal
 *
 * 触发场景: agent chat 里点击引用卡片(见 SummaryCreatePage.renderReferenceHeader)
 *
 * 设计要点(CHAT-REFERENCE-PREVIEW-AND-RANGE-SAVE-v1 决策):
 * - 显示引用总结的**最新版**内容(不是引用时的快照) — 顶部一行提示避免混淆
 * - 复用 SummaryContent 渲染 markdown(不带 citation 交互 — 预览场景够用)
 * - 关闭时父组件负责清空 taskId,避免下次点不同卡片闪一下旧内容
 * - 404/403 → 友好错误"该总结已删除或无权访问"
 *
 * 内容源(与 SummaryDetailPage 一致的双源策略):
 * - 传统 workflow 总结: content 在 summary_result 表 → getSummaryDetail(id).result.content
 * - Agent 生成总结: content 在 summary_personal_result 表 → getPersonalResult(id).content
 * - 因此: 先 getSummaryDetail 拿标题/元信息, 若 result.content 为空则 fallback 到
 *   getPersonalResult(caller 自己的 PR)
 */

interface SummaryPreviewModalProps {
    taskId: number | null;
    onClose: () => void;
}

interface SummaryPreviewModalState {
    loading: boolean;
    detail: SummaryDetail | null;
    // Fallback: 当 detail.result.content 为空(agent 生成的总结) → 从 PersonalResult 拿
    personalResult: PersonalResult | null;
    error: string | null;
}

class SummaryPreviewModal extends Component<SummaryPreviewModalProps, SummaryPreviewModalState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: SummaryPreviewModalState = {
        loading: false,
        detail: null,
        personalResult: null,
        error: null,
    };

    componentDidUpdate(prev: SummaryPreviewModalProps) {
        // taskId 从 null → 数字 = 打开 Modal, 触发加载
        if (this.props.taskId !== prev.taskId && this.props.taskId != null) {
            void this.load(this.props.taskId);
        }
        // taskId 从数字 → null = 关闭, 清 state 避免残留
        if (this.props.taskId == null && prev.taskId != null) {
            this.setState({ detail: null, personalResult: null, error: null, loading: false });
        }
    }

    private load = async (taskId: number) => {
        const { t } = this.context;
        this.setState({ loading: true, detail: null, personalResult: null, error: null });
        try {
            const detail = await getSummaryDetail(taskId);
            // 若 team result 有内容 → 直接用; 否则 fallback 到 PersonalResult(agent 总结走这里)
            const teamContent = detail?.result?.content || '';
            if (teamContent.trim()) {
                this.setState({ loading: false, detail, personalResult: null });
                return;
            }
            // Fallback: 拉自己那份 PR (agent 生成的总结内容都在这)
            try {
                const personal = await getPersonalResult(taskId);
                this.setState({ loading: false, detail, personalResult: personal });
            } catch (personalErr: any) {
                // PR 也拉不到 → 显示 team detail 但内容为空(SummaryContent 会显示 empty state)
                this.setState({ loading: false, detail, personalResult: null });
            }
        } catch (e: any) {
            // 后端约定: 404 → not_found, 403 → forbidden
            const httpStatus = e?.response?.status ?? e?.status;
            let msg: string;
            if (httpStatus === 404 || httpStatus === 403) {
                msg = t('summary.chatReference.previewNotFound');
            } else {
                msg = t('summary.chatReference.previewLoadFailed');
            }
            this.setState({ loading: false, error: msg });
        }
    };

    render() {
        const { taskId, onClose } = this.props;
        const { loading, detail, personalResult, error } = this.state;
        const { t } = this.context;

        const title = detail?.title || (taskId ? t('summary.chatReference.previewTitle') : '');
        // 内容优先: team result → personal result (agent 场景)
        const content = detail?.result?.content?.trim()
            ? detail.result.content
            : (personalResult?.content || '');

        return (
            <Modal
                title={title}
                visible={taskId != null}
                onCancel={onClose}
                footer={null}
                width={720}
                className="summary-preview-modal"
                closeOnEsc
                maskClosable
            >
                <div className="summary-preview-modal-hint">
                    {t('summary.chatReference.previewLatestHint')}
                </div>
                <div className="summary-preview-modal-body">
                    {loading && (
                        <div className="summary-preview-modal-loading">
                            <Spin />
                        </div>
                    )}
                    {!loading && error && (
                        <Empty description={error} />
                    )}
                    {!loading && !error && detail && (
                        <SummaryContent content={content} />
                    )}
                </div>
            </Modal>
        );
    }
}

export default SummaryPreviewModal;
