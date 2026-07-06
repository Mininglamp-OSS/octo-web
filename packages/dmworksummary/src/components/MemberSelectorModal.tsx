import React, { Component } from "react";
import { Modal, Input, Checkbox, Button, Spin, Empty, Avatar } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { I18nContext } from "@octo/base";
import type { MemberCandidate } from "../types/summary";
import * as api from "../api/summaryApi";

interface Props {
    visible: boolean;
    selected: MemberCandidate[];
    onConfirm: (selected: MemberCandidate[]) => void;
    onCancel: () => void;
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
        const { visible, onCancel } = this.props;
        const { keyword, candidates, loading, localSelected } = this.state;
        const { t } = this.context;

        const footer = (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <span style={{ fontSize: 13, color: "var(--semi-color-text-2)" }}>
                    {t("summary.common.selectedPeopleCount", { values: { count: localSelected.length } })}
                </span>
                <div>
                    <Button onClick={onCancel} style={{ marginRight: 8 }}>{t("summary.common.cancel")}</Button>
                    <Button theme="solid" onClick={this.handleConfirm}>{t("summary.common.confirm")}</Button>
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
            >
                <Input
                    prefix={<IconSearch />}
                    placeholder={t("summary.memberSelector.searchPlaceholder")}
                    value={keyword}
                    onChange={this.handleKeywordChange}
                    showClear
                    style={{ marginBottom: 12 }}
                />
                <div style={{ minHeight: 240, maxHeight: 360, overflowY: "auto" }}>
                    {loading ? (
                        <div style={{ textAlign: "center", paddingTop: 60 }}><Spin /></div>
                    ) : candidates.length === 0 ? (
                        <Empty description={t("summary.memberSelector.empty")} style={{ paddingTop: 40 }} />
                    ) : (
                        candidates.map((item) => {
                            const checked = !!localSelected.find((s) => s.user_id === item.user_id);
                            return (
                                <div
                                    key={item.user_id}
                                    onClick={() => this.handleToggle(item)}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        padding: "10px 0",
                                        borderBottom: "1px solid var(--semi-color-border)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <Checkbox checked={checked} style={{ marginRight: 10 }} />
                                    <Avatar size="small" style={{ marginRight: 10, background: "var(--semi-color-primary)" }}>
                                        {item.name.slice(0, 1)}
                                    </Avatar>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 14 }}>{item.name}</div>
                                        {item.department && (
                                            <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
                                                {item.department}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </Modal>
        );
    }
}
