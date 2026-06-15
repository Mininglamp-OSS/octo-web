import React, { Component } from "react";
import { Modal, Input, Tabs, TabPane, Checkbox, Button, Spin, Empty, Tag, Switch } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { I18nContext } from "@octo/base";
import type { ChatCandidate } from "../types/summary";
import * as api from "../api/summaryApi";
import AiBadge from "@octo/base/src/Components/AiBadge";
import WKApp from "@octo/base/src/App";
import SidebarService, { SidebarTargetType } from "@octo/base/src/Service/SidebarService";
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
    activeTab: "followed" | "recent" | "group" | "direct";
    candidates: ChatCandidate[];
    loading: boolean;
    localSelected: ChatCandidate[];
    includeArchived: boolean;
    followedIds: Set<string>;
    recentIds: Set<string>;
    recentOrder: Map<string, number>;
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
        activeTab: "followed",
        candidates: [],
        loading: false,
        localSelected: [],
        includeArchived: false,
        followedIds: new Set<string>(),
        recentIds: new Set<string>(),
        recentOrder: new Map<string, number>(),
    };

    private reqSeq = 0;

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            this.setState({ localSelected: [...this.props.selected], keyword: "", activeTab: "followed", includeArchived: false });
            this.loadCandidates(false);
        }
    }

    async loadCandidates(includeArchivedOverride?: boolean) {
        const includeArchived = includeArchivedOverride ?? this.state.includeArchived;
        const seq = ++this.reqSeq;
        this.setState({ loading: true });
        const deviceUuid = WKApp.shared.deviceId || "";
        // device_uuid 为空时后端 validateSidebarRequest 必拒（SidebarService.ts），
        // 跳过注定失败的 sidebar 请求，followed/recent 退化为空集。
        const skipSidebar = deviceUuid === "";
        try {
            const params = includeArchived ? { include_archived: true } : {};
            const [candidates, followResp, recentResp] = await Promise.all([
                api.getChatCandidates(params),
                skipSidebar ? Promise.resolve(null) : SidebarService.sync({ tab: "follow", device_uuid: deviceUuid }).catch(() => null),
                skipSidebar ? Promise.resolve(null) : SidebarService.sync({ tab: "recent", device_uuid: deviceUuid }).catch(() => null),
            ]);

            const followedIds = new Set<string>();
            for (const item of followResp?.items ?? []) {
                if (item.is_followed) {
                    followedIds.add(`${item.target_type}::${item.target_id}`);
                }
            }

            const recentIds = new Set<string>();
            const recentOrder = new Map<string, number>();
            for (const item of recentResp?.items ?? []) {
                const key = `${item.target_type}::${item.target_id}`;
                recentIds.add(key);
                recentOrder.set(key, item.timestamp);
            }

            if (seq !== this.reqSeq) return;
            this.setState({ candidates, followedIds, recentIds, recentOrder, loading: false });
        } catch {
            if (seq !== this.reqSeq) return;
            this.setState({ loading: false });
        }
    }

    handleIncludeArchivedChange = (checked: boolean) => {
        this.setState({ includeArchived: checked });
        this.loadCandidates(checked);
    };

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

    // chat_type → SidebarTargetType 映射，用于构建类型安全的复合 key
    static chatTypeToTargetType(chatType: string): number {
        switch (chatType) {
            case "direct": return SidebarTargetType.DM;
            case "thread": return SidebarTargetType.THREAD;
            default: return SidebarTargetType.CHANNEL;
        }
    }

    // 构建复合 key：${target_type}::${id}，防止跨类型 id 碰撞
    static compositeKey(chatType: string, chatId: string): string {
        return `${ChatSelectorModal.chatTypeToTargetType(chatType)}::${chatId}`;
    }

    getDisplayList(): DisplayEntry[] {
        const { candidates, activeTab, keyword } = this.state;
        const kw = keyword.trim().toLowerCase();

        if (activeTab === "direct") {
            return candidates
                .filter((c) => c.chat_type === "direct")
                .filter((c) => !kw || c.name.toLowerCase().includes(kw))
                .map((c) => ({ item: c, indent: false }));
        }

        if (activeTab === "recent") {
            const { recentIds, recentOrder } = this.state;
            return candidates
                .filter((c) => recentIds.has(ChatSelectorModal.compositeKey(c.chat_type, c.chat_id)))
                .filter((c) => !kw || c.name.toLowerCase().includes(kw))
                .sort((a, b) => (recentOrder.get(ChatSelectorModal.compositeKey(b.chat_type, b.chat_id)) ?? 0) - (recentOrder.get(ChatSelectorModal.compositeKey(a.chat_type, a.chat_id)) ?? 0))
                .map((c) => ({ item: c, indent: false }));
        }

        // followed：纯前端按本地集合过滤，切 tab 不重新请求后端。
        const { followedIds } = activeTab === "followed" ? this.state : { followedIds: null };
        const inScope = (c: ChatCandidate): boolean => {
            if (followedIds) return followedIds.has(ChatSelectorModal.compositeKey(c.chat_type, c.chat_id));
            return true;
        };

        const groups = candidates.filter((c) => c.chat_type === "group" && inScope(c));
        const threads = candidates.filter((c) => c.chat_type === "thread" && inScope(c));
        const directs =
            activeTab === "followed"
                ? candidates.filter((c) => c.chat_type === "direct" && inScope(c))
                : [];

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
                        {item.is_archived && (
                            <Tag size="small" color="grey" style={{ marginLeft: 6 }}>
                                {t("summary.chatSelector.archivedTag")}
                            </Tag>
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
        const { keyword, activeTab, loading, localSelected, includeArchived } = this.state;
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
                    <TabPane tab={t("summary.chatSelector.followed")} itemKey="followed" />
                    <TabPane tab={t("summary.chatSelector.recent")} itemKey="recent" />
                    <TabPane tab={t("summary.chatSelector.allGroups")} itemKey="group" />
                    <TabPane tab={t("summary.chatSelector.allDirects")} itemKey="direct" />
                </Tabs>
                <div style={{ display: "flex", alignItems: "center", padding: "8px 0", gap: 8 }}>
                    <Switch
                        checked={includeArchived}
                        onChange={this.handleIncludeArchivedChange}
                        size="small"
                        aria-label={t("summary.chatSelector.includeArchived")}
                    />
                    <span style={{ fontSize: 13 }}>{t("summary.chatSelector.includeArchived")}</span>
                    <span style={{ fontSize: 12, color: "var(--semi-color-text-2)" }}>
                        {t("summary.chatSelector.includeArchivedHelper")}
                    </span>
                </div>
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
