import React, { Component } from "react";
import { Modal, Input, Tabs, TabPane, Checkbox, Button, Spin, Empty, Tag } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { I18nContext } from "@octo/base";
import type { ChatCandidate } from "../types/summary";
import * as api from "../api/summaryApi";
import AiBadge from "@octo/base/src/Components/AiBadge";
import { MAX_CHAT_SELECT } from "../constants/limits";

interface Props {
    visible: boolean;
    selected: ChatCandidate[];
    onConfirm: (selected: ChatCandidate[]) => void;
    onCancel: () => void;
    maxSelect?: number;
}

interface State {
    keyword: string;
    activeTab: "all" | "group" | "direct";
    candidates: ChatCandidate[];
    loading: boolean;
    localSelected: ChatCandidate[];
}

interface DisplayEntry {
    item: ChatCandidate;
    indent: boolean;
}

export default class ChatSelectorModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: State = {
        keyword: "",
        activeTab: "all",
        candidates: [],
        loading: false,
        localSelected: [],
    };

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ localSelected: [...this.props.selected], keyword: "", activeTab: "all" });
            this.loadCandidates();
        }
    }

    async loadCandidates() {
        this.setState({ loading: true });
        try {
            const candidates = await api.getChatCandidates({});
            this.setState({ candidates, loading: false });
        } catch {
            this.setState({ loading: false });
        }
    }

    handleKeywordChange = (val: string) => {
        this.setState({ keyword: val });
    };

    handleTabChange = (tab: string) => {
        this.setState({ activeTab: tab as State["activeTab"] });
    };

    handleToggle = (item: ChatCandidate) => {
        const { localSelected } = this.state;
        const maxSelect = this.props.maxSelect ?? MAX_CHAT_SELECT;
        const existing = localSelected.find((s) => s.chat_id === item.chat_id);
        if (existing) {
            this.setState({ localSelected: localSelected.filter((s) => s.chat_id !== item.chat_id) });
        } else {
            if (localSelected.length >= maxSelect) return;
            this.setState({ localSelected: [...localSelected, item] });
        }
    };

    handleConfirm = () => {
        this.props.onConfirm(this.state.localSelected);
    };

    getDisplayList(): DisplayEntry[] {
        const { candidates, activeTab, keyword } = this.state;
        const kw = keyword.trim().toLowerCase();

        if (activeTab === "direct") {
            return candidates
                .filter((c) => c.chat_type === "direct")
                .filter((c) => !kw || c.name.toLowerCase().includes(kw))
                .map((c) => ({ item: c, indent: false }));
        }

        const groups = candidates.filter((c) => c.chat_type === "group");
        const threads = candidates.filter((c) => c.chat_type === "thread");
        const directs = activeTab === "all" ? candidates.filter((c) => c.chat_type === "direct") : [];

        const groupIds = new Set(groups.map((g) => g.chat_id));
        const threadsByParent = new Map<string, ChatCandidate[]>();
        const orphanThreads: ChatCandidate[] = [];
        for (const t of threads) {
            if (t.parent_group_no && groupIds.has(t.parent_group_no)) {
                const arr = threadsByParent.get(t.parent_group_no) || [];
                arr.push(t);
                threadsByParent.set(t.parent_group_no, arr);
            } else {
                orphanThreads.push(t);
            }
        }

        const result: DisplayEntry[] = [];

        if (!kw) {
            for (const g of groups) {
                result.push({ item: g, indent: false });
                for (const t of threadsByParent.get(g.chat_id) || []) {
                    result.push({ item: t, indent: true });
                }
            }
            for (const t of orphanThreads) {
                result.push({ item: t, indent: false });
            }
            for (const d of directs) {
                result.push({ item: d, indent: false });
            }
        } else {
            const matchingGroupIds = new Set(
                groups.filter((g) => g.name.toLowerCase().includes(kw)).map((g) => g.chat_id),
            );
            const matchingThreads = threads.filter((t) => t.name.toLowerCase().includes(kw));
            const parentIdsFromThreads = new Set(
                matchingThreads.map((t) => t.parent_group_no).filter(Boolean) as string[],
            );

            const groupsToShow = groups.filter(
                (g) => matchingGroupIds.has(g.chat_id) || parentIdsFromThreads.has(g.chat_id),
            );

            for (const g of groupsToShow) {
                result.push({ item: g, indent: false });
                const children = threadsByParent.get(g.chat_id) || [];
                const filtered = matchingGroupIds.has(g.chat_id)
                    ? children
                    : children.filter((t) => t.name.toLowerCase().includes(kw));
                for (const t of filtered) {
                    result.push({ item: t, indent: true });
                }
            }

            for (const t of orphanThreads) {
                if (t.name.toLowerCase().includes(kw)) {
                    result.push({ item: t, indent: false });
                }
            }

            for (const d of directs) {
                if (d.name.toLowerCase().includes(kw)) {
                    result.push({ item: d, indent: false });
                }
            }
        }

        return result;
    }

    renderItem = (entry: DisplayEntry) => {
        const { localSelected } = this.state;
        const maxSelect = this.props.maxSelect ?? MAX_CHAT_SELECT;
        const { item, indent } = entry;
        const { t } = this.context;
        const checked = !!localSelected.find((s) => s.chat_id === item.chat_id);
        const disabled = !checked && localSelected.length >= maxSelect;
        return (
            <div
                key={item.chat_id}
                onClick={() => !disabled && this.handleToggle(item)}
                style={{
                    display: "flex",
                    alignItems: "center",
                    padding: indent ? "6px 0" : "10px 0",
                    paddingLeft: indent ? 32 : 0,
                    borderBottom: "1px solid var(--semi-color-border)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                }}
            >
                <Checkbox checked={checked} disabled={disabled} style={{ marginRight: 10 }} />
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: indent ? 13 : 14, display: "flex", alignItems: "center" }}>
                        {item.name}
                        {item.chat_type === "direct" && item.is_bot && (
                            <span style={{ marginLeft: 4 }}><AiBadge size="small" /></span>
                        )}
                    </div>
                    {item.member_count !== null && (
                        <div style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
                            {t("summary.common.peopleCount", { values: { count: item.member_count } })}
                        </div>
                    )}
                </div>
                <Tag size="small" color={
                    item.chat_type === "group" ? "blue" :
                    item.chat_type === "thread" ? "green" :
                    "cyan"
                }>
                    {item.chat_type === "group" ? t("summary.source.groupChat") :
                     item.chat_type === "thread" ? t("summary.source.thread") :
                     t("summary.source.directMessage")}
                </Tag>
            </div>
        );
    };

    render() {
        const { visible, onCancel, maxSelect = MAX_CHAT_SELECT } = this.props;
        const { keyword, activeTab, loading, localSelected } = this.state;
        const { t } = this.context;
        const displayList = this.getDisplayList();

        const footer = (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <span style={{ fontSize: 13, color: "var(--semi-color-text-2)" }}>
                    {t("summary.common.selectedCount", { values: { count: localSelected.length, max: maxSelect } })}
                </span>
                <div>
                    <Button onClick={onCancel} style={{ marginRight: 8 }}>{t("summary.common.cancel")}</Button>
                    <Button theme="solid" onClick={this.handleConfirm}>{t("summary.common.confirm")}</Button>
                </div>
            </div>
        );

        return (
            <Modal
                title={t("summary.chatSelector.title")}
                visible={visible}
                onCancel={onCancel}
                footer={footer}
                width={480}
                bodyStyle={{ padding: "0 24px" }}
            >
                <Input
                    prefix={<IconSearch />}
                    placeholder={t("summary.chatSelector.searchPlaceholder")}
                    value={keyword}
                    onChange={this.handleKeywordChange}
                    showClear
                    style={{ marginBottom: 12 }}
                />
                <Tabs activeKey={activeTab} onChange={this.handleTabChange} size="small">
                    <TabPane tab={t("summary.chatSelector.all")} itemKey="all" />
                    <TabPane tab={t("summary.source.groupChat")} itemKey="group" />
                    <TabPane tab={t("summary.source.directMessage")} itemKey="direct" />
                </Tabs>
                <div style={{ minHeight: 240, maxHeight: 360, overflowY: "auto" }}>
                    {loading ? (
                        <div style={{ textAlign: "center", paddingTop: 60 }}><Spin /></div>
                    ) : displayList.length === 0 ? (
                        <Empty description={t("summary.chatSelector.noData")} style={{ paddingTop: 40 }} />
                    ) : (
                        displayList.map((entry) => this.renderItem(entry))
                    )}
                </div>
            </Modal>
        );
    }
}
