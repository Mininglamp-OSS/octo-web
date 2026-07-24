import React, { Component } from "react";
import { Checkbox, Spin, Empty, Tag } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { X } from "lucide-react";
import { I18nContext } from "@octo/base";
import WKAvatar, { isBot } from "@octo/base/src/Components/WKAvatar";
import AiBadge from "@octo/base/src/Components/AiBadge";
import { Channel, ChannelTypePerson, WKSDK } from "wukongimjssdk";
import type { ChatCandidate } from "../types/summary";
import * as api from "../api/summaryApi";
import WKApp from "@octo/base/src/App";
import SidebarService, { SidebarTargetType } from "@octo/base/src/Service/SidebarService";
import { MAX_CHAT_SELECT } from "../constants/limits";

interface MemberCandidate {
    uid: string;
    name: string;
    avatar?: string;
    is_bot?: boolean;
}

interface Props {
    visible: boolean;
    selected: ChatCandidate[];
    onConfirm: (selected: ChatCandidate[]) => void;
    onCancel: () => void;
    maxSelect?: number;
    mode?: "chat" | "members";
    channel?: Channel | null;
    selectedMembers?: MemberCandidate[];
    onConfirmMembers?: (members: MemberCandidate[]) => void;
}

interface State {
    keyword: string;
    activeTab: "followed" | "recent" | "group" | "direct" | "all_members" | "managers" | "normal_members";
    candidates: ChatCandidate[];
    memberRoles: Map<string, number>;
    loading: boolean;
    localSelected: ChatCandidate[];
    localSelectedMembers: MemberCandidate[];
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
        memberRoles: new Map<string, number>(),
        loading: false,
        localSelected: [],
        localSelectedMembers: [],
        includeArchived: false,
        followedIds: new Set<string>(),
        recentIds: new Set<string>(),
        recentOrder: new Map<string, number>(),
    };

    private reqSeq = 0;

    componentDidUpdate(prevProps: Props) {
        if (this.props.visible && !prevProps.visible) {
            if (this.props.mode === "members") {
                this.setState({
                    localSelectedMembers: [...(this.props.selectedMembers ?? [])],
                    keyword: "",
                    activeTab: "all_members",
                });
                this.loadMembers();
            } else {
                this.setState({ localSelected: [...this.props.selected], keyword: "", activeTab: "followed", includeArchived: false });
                this.loadCandidates(false);
            }
        }
    }

    async loadMembers() {
        const channel = this.props.channel;
        if (!channel) return;
        this.setState({ loading: true });
        try {
            const sdk = WKSDK.shared();
            await sdk.channelManager.syncSubscribes(channel);
            const subscribers = sdk.channelManager.getSubscribes(channel) || [];
            const humans = subscribers.filter((m: any) => !m.is_bot && !isBot(m.uid));
            const roles = new Map<string, number>();
            for (const m of humans) {
                if (m.role != null) roles.set(m.uid, m.role);
            }
            this.setState({
                memberRoles: roles,
                candidates: humans.map((m: any) => ({
                    chat_id: m.uid,
                    chat_type: "direct" as const,
                    name: m.name || m.uid,
                    member_count: null,
                })),
            });
        } catch {
            this.setState({ candidates: [] });
        } finally {
            this.setState({ loading: false });
        }
    }

    async loadCandidates(includeArchivedOverride?: boolean) {
        const includeArchived = includeArchivedOverride ?? this.state.includeArchived;
        const seq = ++this.reqSeq;
        this.setState({ loading: true });
        const deviceUuid = WKApp.shared.deviceId || "";
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
        if (this.props.mode === "members") {
            this.props.onConfirmMembers?.(this.state.localSelectedMembers);
        } else {
            this.props.onConfirm(this.state.localSelected);
        }
    };

    handleToggleMember = (member: MemberCandidate) => {
        const { localSelectedMembers } = this.state;
        const maxSelect = this.props.maxSelect ?? MAX_CHAT_SELECT;
        const existing = localSelectedMembers.find((m) => m.uid === member.uid);
        if (existing) {
            this.setState({ localSelectedMembers: localSelectedMembers.filter((m) => m.uid !== member.uid) });
        } else {
            if (localSelectedMembers.length >= maxSelect) return;
            this.setState({ localSelectedMembers: [...localSelectedMembers, member] });
        }
    };

    static chatTypeToTargetType(chatType: string): number {
        switch (chatType) {
            case "direct": return SidebarTargetType.DM;
            case "thread": return SidebarTargetType.THREAD;
            default: return SidebarTargetType.CHANNEL;
        }
    }

    static compositeKey(chatType: string, chatId: string): string {
        return `${ChatSelectorModal.chatTypeToTargetType(chatType)}::${chatId}`;
    }

    getDisplayList(): DisplayEntry[] {
        const { candidates, activeTab, keyword } = this.state;
        const kw = keyword.trim().toLowerCase();

        // members 模式：按 tab 过滤角色 + 搜索
        if (this.props.mode === "members") {
            const { memberRoles } = this.state;
            return candidates
                .filter((c) => {
                    if (activeTab === "all_members") return true;
                    const role = memberRoles.get(c.chat_id);
                    if (activeTab === "managers") return role === 1 || role === 2; // owner=1, manager=2
                    if (activeTab === "normal_members") return role == null || role === 0; // normal
                    return true;
                })
                .filter((c) => !kw || c.name.toLowerCase().includes(kw))
                .map((c) => ({ item: c, indent: false }));
        }

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

    getChannelTypeNum(chatType: string): number {
        switch (chatType) {
            case "direct": return 1;
            case "thread": return 5;
            default: return 2;
        }
    }

    renderMemberItem = (entry: DisplayEntry) => {
        const { localSelectedMembers } = this.state;
        const maxSelect = this.props.maxSelect ?? MAX_CHAT_SELECT;
        const { item } = entry;
        const checked = !!localSelectedMembers.find((m) => m.uid === item.chat_id);
        const disabled = !checked && localSelectedMembers.length >= maxSelect;
        return (
            <div
                key={item.chat_id}
                className={`chat-selector-item${disabled ? " chat-selector-item--disabled" : ""}`}
                onClick={() => !disabled && this.handleToggleMember({ uid: item.chat_id, name: item.name })}
            >
                <Checkbox checked={checked} disabled={disabled} />
                <WKAvatar
                    channel={new Channel(item.chat_id, ChannelTypePerson)}
                    style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}
                />
                <div className="chat-selector-item-info">
                    <span className="chat-selector-item-name">{item.name}</span>
                </div>
            </div>
        );
    };

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
                className={`chat-selector-item${indent ? " chat-selector-item--indent" : ""}${disabled ? " chat-selector-item--disabled" : ""}`}
                onClick={() => !disabled && this.handleToggle(item)}
            >
                <Checkbox checked={checked} disabled={disabled} />
                <WKAvatar
                    channel={new Channel(item.chat_id, this.getChannelTypeNum(item.chat_type))}
                    style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}
                />
                <div className="chat-selector-item-info">
                    <span className="chat-selector-item-name">
                        {item.name}
                        {item.chat_type === "direct" && item.is_bot && (
                            <AiBadge size="small" />
                        )}
                        {item.is_archived && (
                            <Tag size="small" color="grey">{t("summary.chatSelector.archivedTag")}</Tag>
                        )}
                    </span>
                    {item.member_count !== null && (
                        <span className="chat-selector-item-meta">
                            {t("summary.common.peopleCount", { values: { count: item.member_count } })}
                        </span>
                    )}
                </div>
            </div>
        );
    };

    renderSelected = (item: ChatCandidate) => {
        return (
            <div key={item.chat_id} className="chat-selector-selected-item">
                <WKAvatar
                    channel={new Channel(item.chat_id, this.getChannelTypeNum(item.chat_type))}
                    style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}
                />
                <span className="chat-selector-selected-name">{item.name}</span>
                <button
                    type="button"
                    className="chat-selector-selected-remove"
                    onClick={() => this.handleToggle(item)}
                >
                    <X size={16} />
                </button>
            </div>
        );
    };

    render() {
        const { visible, onCancel, mode } = this.props;
        const { keyword, activeTab, loading, localSelected, localSelectedMembers, includeArchived } = this.state;
        const { t } = this.context;
        const displayList = this.getDisplayList();

        const chatTabs = [
            { key: "followed", label: t("summary.chatSelector.followed") },
            { key: "recent", label: t("summary.chatSelector.recent") },
            { key: "group", label: t("summary.chatSelector.allGroups") },
            { key: "direct", label: t("summary.chatSelector.allDirects") },
        ];

        const memberTabs = [
            { key: "all_members", label: t("summary.chatSelector.allMembers") },
            { key: "managers", label: t("summary.chatSelector.managers") },
            { key: "normal_members", label: t("summary.chatSelector.normalMembers") },
        ];

        const currentTabs = mode === "members" ? memberTabs : chatTabs;

        if (!visible) return null;

        return (
            <div className="chat-selector-overlay" onClick={onCancel}>
                <div className="chat-selector-modal" onClick={(e) => e.stopPropagation()}>
                    {/* Header */}
                    <div className="chat-selector-header">
                        <span className="chat-selector-title">{mode === "members" ? t("summary.create.selectMembers") : t("summary.chatSelector.title")}</span>
                        <button type="button" className="chat-selector-close" onClick={onCancel}>
                            <X size={20} />
                        </button>
                    </div>

                    {/* Content: two columns */}
                    <div className="chat-selector-content">
                        {/* Left column */}
                        <div className="chat-selector-left">
                            <div className="chat-selector-search">
                                <IconSearch className="chat-selector-search-icon" />
                                <input
                                    className="chat-selector-search-input"
                                    placeholder={t("summary.chatSelector.searchPlaceholder")}
                                    value={keyword}
                                    onChange={(e) => this.handleKeywordChange(e.target.value)}
                                />
                            </div>
                            <div className="chat-selector-tabs">
                                {currentTabs.map((tab) => (
                                    <button
                                        key={tab.key}
                                        className={`chat-selector-tab${activeTab === tab.key ? " chat-selector-tab--active" : ""}`}
                                        onClick={() => this.handleTabChange(tab.key)}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                            {mode !== "members" && (activeTab === "group" || activeTab === "followed") && (
                                <label className="chat-selector-archived-toggle">
                                    <Checkbox
                                        checked={includeArchived}
                                        onChange={(e) => this.handleIncludeArchivedChange(e.target.checked)}
                                    />
                                    <span>{t("summary.chatSelector.includeArchived")}</span>
                                </label>
                            )}
                            <div className="chat-selector-list">
                                {loading ? (
                                    <div className="chat-selector-loading"><Spin /></div>
                                ) : mode === "members" ? (
                                    displayList.map((entry) => this.renderMemberItem(entry))
                                ) : displayList.length === 0 ? (
                                    <Empty description={t("summary.chatSelector.noData")} />
                                ) : (
                                    displayList.map((entry) => this.renderItem(entry))
                                )}
                            </div>
                        </div>

                        {/* Right column */}
                        <div className="chat-selector-right">
                            <div className="chat-selector-right-header">
                                {mode === "members"
                                    ? t("summary.common.selectedCount", { values: { count: localSelectedMembers.length, max: this.props.maxSelect ?? MAX_CHAT_SELECT } })
                                    : t("summary.common.selectedCount", { values: { count: localSelected.length, max: this.props.maxSelect ?? MAX_CHAT_SELECT } })}
                            </div>
                            <div className="chat-selector-right-list">
                                {mode === "members"
                                    ? localSelectedMembers.map((m) => (
                                        <div key={m.uid} className="chat-selector-selected-item">
                                            <WKAvatar
                                                channel={new Channel(m.uid, ChannelTypePerson)}
                                                style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}
                                            />
                                            <span className="chat-selector-selected-name">{m.name}</span>
                                            <button
                                                type="button"
                                                className="chat-selector-selected-remove"
                                                onClick={() => this.handleToggleMember(m)}
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))
                                    : localSelected.map((item) => this.renderSelected(item))
                                }
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="chat-selector-footer">
                        <button type="button" className="chat-selector-btn chat-selector-btn--cancel" onClick={onCancel}>
                            {t("summary.common.cancel")}
                        </button>
                        <button type="button" className="chat-selector-btn chat-selector-btn--confirm" onClick={this.handleConfirm}>
                            {t("summary.common.confirm")}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
