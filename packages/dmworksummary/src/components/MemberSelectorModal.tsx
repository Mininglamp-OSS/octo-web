import React, { Component } from "react";
import { Modal, Input, Checkbox, Button, Spin, Empty, Avatar } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { I18nContext } from "@octo/base";
import type { MemberCandidate } from "../types/summary";
import * as api from "../api/summaryApi";
import "./SummarySelectors.css";

interface Props {
    visible: boolean;
    selected: MemberCandidate[];
    onConfirm: (selected: MemberCandidate[]) => void;
    onCancel: () => void;
    /** 需排除的 user_id（如已是任务成员），不出现在候选列表中。 */
    excludedUserIds?: string[];
    /** 提交中：确认按钮 loading、取消/确认 disabled，防重复提交。 */
    confirmLoading?: boolean;
}

interface State {
    keyword: string;
    candidates: MemberCandidate[];
    loading: boolean;
    localSelected: MemberCandidate[];
}

export default class MemberSelectorModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private searchTimer: ReturnType<typeof setTimeout> | null = null;

    state: State = {
        keyword: "",
        candidates: [],
        loading: false,
        localSelected: [],
    };

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ localSelected: [...this.props.selected], keyword: "" });
            this.loadCandidates();
        }
    }

    componentWillUnmount() {
        if (this.searchTimer) {
            clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
    }

    async loadCandidates(keyword?: string) {
        this.setState({ loading: true });
        try {
            const candidates = await api.getMemberCandidates({ keyword });
            this.setState({ candidates, loading: false });
        } catch {
            this.setState({ loading: false });
        }
    }

    handleKeywordChange = (val: string) => {
        this.setState({ keyword: val });
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => this.loadCandidates(val), 300);
    };

    handleToggle = (item: MemberCandidate) => {
        const { localSelected } = this.state;
        const existing = localSelected.find((s) => s.user_id === item.user_id);
        if (existing) {
            this.setState({ localSelected: localSelected.filter((s) => s.user_id !== item.user_id) });
        } else {
            this.setState({ localSelected: [...localSelected, item] });
        }
    };

    handleConfirm = () => {
        this.props.onConfirm(this.state.localSelected);
    };

    render() {
        const { visible, onCancel, confirmLoading, excludedUserIds } = this.props;
        const { keyword, candidates, loading, localSelected } = this.state;
        const { t } = this.context;
        const excludeSet = new Set(excludedUserIds || []);
        const visibleCandidates = candidates.filter((c) => !excludeSet.has(c.user_id));

        const footer = (
            <div className="summary-selector-footer">
                <span className="summary-selector-footer-count">
                    {t("summary.common.selectedPeopleCount", { values: { count: localSelected.length } })}
                </span>
                <div className="summary-selector-footer-actions">
                    <Button onClick={onCancel} disabled={confirmLoading}>{t("summary.common.cancel")}</Button>
                    <Button theme="solid" loading={confirmLoading} disabled={confirmLoading} onClick={this.handleConfirm}>{t("summary.common.confirm")}</Button>
                </div>
            </div>
        );

        return (
            <Modal
                title={t("summary.memberSelector.title")}
                visible={visible}
                onCancel={onCancel}
                footer={footer}
                width={480}
                bodyStyle={{ padding: "0 24px" }}
                className="summary-selector-modal"
            >
                <div className="summary-selector-modal-body">
                    <Input
                        prefix={<IconSearch />}
                        placeholder={t("summary.memberSelector.searchPlaceholder")}
                        value={keyword}
                        onChange={this.handleKeywordChange}
                        showClear
                        className="summary-selector-search"
                    />
                    <div className="summary-selector-list">
                        {loading ? (
                            <div className="summary-selector-loading"><Spin /></div>
                        ) : visibleCandidates.length === 0 ? (
                            <Empty description={t("summary.memberSelector.empty")} className="summary-selector-empty" />
                        ) : (
                            visibleCandidates.map((item) => {
                                const checked = !!localSelected.find((s) => s.user_id === item.user_id);
                                return (
                                    <div
                                        key={item.user_id}
                                        onClick={() => this.handleToggle(item)}
                                        className={`summary-selector-item${checked ? " summary-selector-item--selected" : ""}`}
                                    >
                                        <Checkbox checked={checked} />
                                        <Avatar size="small" className="summary-selector-item-avatar">
                                            {item.name.slice(0, 1)}
                                        </Avatar>
                                        <div className="summary-selector-item-main">
                                            <div className="summary-selector-item-title">{item.name}</div>
                                            {item.department && (
                                                <div className="summary-selector-item-meta">
                                                    {item.department}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </Modal>
        );
    }
}
