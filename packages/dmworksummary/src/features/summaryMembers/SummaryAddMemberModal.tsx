import React, { Component } from "react";
import { Modal, Button, Checkbox, Spin, Empty, Toast, Input } from "@douyinfe/semi-ui";
import { IconSearch } from "@douyinfe/semi-icons";
import { I18nContext } from "@octo/base";
import WKApp from "@octo/base/src/App";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import WKAvatar, { isBot } from "@octo/base/src/Components/WKAvatar";
import type {
    SummaryConversationMember,
    SummaryMessagingPort,
    SummaryConversationTarget,
} from "../../host/types";
import * as api from "../../api/summaryApi";
import { summaryTestIds } from "../../utils/testIds";
import { isActiveSummaryGroupMember } from "../../host/memberPolicy";
import "../../components/SummarySelectors.css";

interface MemberCandidate {
    uid: string;
    name: string;
}

interface Props {
    visible: boolean;
    taskId: number;
    target: SummaryConversationTarget;
    existingMemberIds: string[];
    messaging: SummaryMessagingPort;
    onClose: () => void;
    onSuccess: () => void;
}

interface State {
    candidates: MemberCandidate[];
    loading: boolean;
    loadError: string | null;
    searchKeyword: string;
    selectedUids: Set<string>;
    submitting: boolean;
}

interface OpeningSnapshot {
    epoch: number;
    taskId: number;
    channelId: string;
    channelType: number;
    spaceId: string | null;
}

function readSpaceId(): string | null {
    const shared = WKApp.shared as { currentSpaceId?: string | null };
    return shared.currentSpaceId ?? null;
}

export default class SummaryAddMemberModal extends Component<Props, State> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: State = {
        candidates: [],
        loading: false,
        loadError: null,
        searchKeyword: "",
        selectedUids: new Set(),
        submitting: false,
    };

    private mounted = false;
    /** 每次打开/关闭/换 task/换 target 递增，作废在途 load/save 回调。 */
    private openingEpoch = 0;
    /** 本次打开捕获的上下文快照；关闭/卸载/失效时置空，防止迟到结果落错上下文。 */
    private activeOpening: OpeningSnapshot | null = null;

    private buildSnapshot(): OpeningSnapshot {
        return {
            epoch: this.openingEpoch,
            taskId: this.props.taskId,
            channelId: this.props.target.channelId,
            channelType: this.props.target.channelType,
            spaceId: readSpaceId(),
        };
    }

    componentDidMount() {
        this.mounted = true;
        if (this.props.visible) {
            this.beginOpening();
        }
    }

    componentWillUnmount() {
        this.mounted = false;
        this.activeOpening = null;
    }

    componentDidUpdate(prevProps: Props) {
        const targetChanged =
            this.props.target.channelId !== prevProps.target.channelId ||
            this.props.target.channelType !== prevProps.target.channelType ||
            this.props.taskId !== prevProps.taskId;
        if (targetChanged) {
            if (this.props.visible) {
                this.beginOpening();
            } else {
                this.invalidateOpening();
            }
            return;
        }
        if (this.props.visible && !prevProps.visible) {
            this.beginOpening();
        } else if (!this.props.visible && prevProps.visible) {
            this.closeOpening();
        }
    }

    /** 新打开/重开：递增 epoch、清空旧状态并重新加载。 */
    private beginOpening() {
        this.openingEpoch++;
        this.activeOpening = this.buildSnapshot();
        this.setState({
            candidates: [],
            loading: false,
            loadError: null,
            selectedUids: new Set(),
            searchKeyword: "",
            submitting: false,
        });
        this.loadCandidates();
    }

    /** task/target 变化：作废在途请求与本地勾选，清空等待下一次打开。 */
    private invalidateOpening() {
        this.openingEpoch++;
        this.activeOpening = null;
        this.setState({
            candidates: [],
            loading: false,
            loadError: null,
            selectedUids: new Set(),
            searchKeyword: "",
            submitting: false,
        });
    }

    /** 关闭：仅作废在途请求与快照，保留状态待下次打开重置。 */
    private closeOpening() {
        this.openingEpoch++;
        this.activeOpening = null;
    }

    private loadCandidates = async () => {
        const snap = this.activeOpening;
        if (!snap) return;
        this.setState({ loading: true, loadError: null, selectedUids: new Set(), searchKeyword: "" });
        try {
            const members = await this.props.messaging.loadConversationMembers(this.props.target);
            if (!this.snapshotStillValid(snap)) return;
            const excluded = new Set(this.props.existingMemberIds);
            const candidates = members
                .filter((m: SummaryConversationMember) =>
                    Boolean(m.uid) && isActiveSummaryGroupMember(m) &&
                    !m.isBot && !isBot(m.uid) && !excluded.has(m.uid)
                )
                .map((m: SummaryConversationMember): MemberCandidate => ({
                    uid: m.uid,
                    name: m.name,
                }));
            this.setState({ candidates, loading: false });
        } catch {
            if (!this.snapshotStillValid(snap)) return;
            this.setState({ loading: false, loadError: "load_failed", candidates: [] });
        }
    };

    private snapshotStillValid(snap: OpeningSnapshot): boolean {
        return (
            this.mounted &&
            this.props.visible &&
            this.activeOpening === snap &&
            snap.epoch === this.openingEpoch &&
            snap.taskId === this.props.taskId &&
            snap.channelId === this.props.target.channelId &&
            snap.channelType === this.props.target.channelType &&
            snap.spaceId === readSpaceId()
        );
    }

    private handleKeywordChange = (val: string) => {
        this.setState({ searchKeyword: val });
    };

    private handleToggle = (uid: string) => {
        if (this.state.submitting) return;
        this.setState((prev) => {
            const next = new Set(prev.selectedUids);
            if (next.has(uid)) {
                next.delete(uid);
            } else {
                next.add(uid);
            }
            return { selectedUids: next };
        });
    };

    private handleKeyDown = (uid: string) => (e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this.handleToggle(uid);
        }
    };

    private handleConfirm = async () => {
        const { t } = this.context;
        const uids = Array.from(this.state.selectedUids);
        if (uids.length === 0 || this.state.submitting) return;
        const snap = this.activeOpening;
        // BEFORE-setState guard: opening context must still be current.
        if (!snap || !this.snapshotStillValid(snap)) return;
        this.setState({ submitting: true });
        // BEFORE-api guard: context unchanged after setState flush.
        if (!this.snapshotStillValid(snap)) return;
        try {
            await api.addMembers(snap.taskId, uids);
            if (!this.snapshotStillValid(snap)) return;
            Toast.success(t("summary.detail.addMemberSuccess"));
            this.props.onSuccess();
        } catch (err: unknown) {
            if (!this.snapshotStillValid(snap)) return;
            const message = (err as { message?: string }).message ?? t("summary.detail.addMemberFailed");
            Toast.error(message);
        } finally {
            if (this.snapshotStillValid(snap)) {
                this.setState({ submitting: false });
            }
        }
    };

    render() {
        const { visible, onClose } = this.props;
        const { candidates, loading, loadError, searchKeyword, selectedUids, submitting } = this.state;
        const { t } = this.context;

        const kw = searchKeyword.trim().toLowerCase();
        const filtered = kw ? candidates.filter((m) => m.name.toLowerCase().includes(kw)) : candidates;

        return (
            <Modal
                title={t("summary.detail.addMember")}
                visible={visible}
                onCancel={onClose}
                width={420}
                data-testid={summaryTestIds.addMemberModal}
                footer={
                    <div className="summary-selector-footer">
                        <div />
                        <div className="summary-selector-footer-actions">
                            <Button onClick={onClose} disabled={submitting}>
                                {t("summary.common.cancel")}
                            </Button>
                            <Button
                                theme="solid"
                                loading={submitting}
                                disabled={selectedUids.size === 0 || submitting}
                                data-testid={summaryTestIds.addMemberConfirmBtn}
                                onClick={this.handleConfirm}
                            >
                                {t("summary.common.confirm")}
                            </Button>
                        </div>
                    </div>
                }
            >
                <div className="summary-selector-modal-body">
                    <Input
                        prefix={<IconSearch />}
                        placeholder={t("summary.memberSelector.searchPlaceholder")}
                        value={searchKeyword}
                        onChange={this.handleKeywordChange}
                        showClear
                        className="summary-selector-search"
                        data-testid={summaryTestIds.addMemberSearchInput}
                    />
                    <div className="summary-selector-list">
                        {loading ? (
                            <div className="summary-selector-loading"><Spin /></div>
                        ) : loadError ? (
                            <div className="summary-selector-empty">
                                <Empty description={t("summary.common.loadingFailed")} />
                                <Button
                                    size="small"
                                    data-testid={summaryTestIds.addMemberRetryBtn}
                                    onClick={this.loadCandidates}
                                >
                                    {t("summary.common.retry")}
                                </Button>
                            </div>
                        ) : filtered.length === 0 ? (
                            <Empty
                                className="summary-selector-empty"
                                description={t("summary.memberSelector.empty")}
                            />
                        ) : (
                            filtered.map((m) => {
                                const checked = selectedUids.has(m.uid);
                                return (
                                    <div
                                        key={m.uid}
                                        data-testid={summaryTestIds.addMemberMemberRow(m.uid)}
                                        onClick={() => this.handleToggle(m.uid)}
                                        onKeyDown={this.handleKeyDown(m.uid)}
                                        role="option"
                                        aria-selected={checked}
                                        tabIndex={submitting ? -1 : 0}
                                        className={`summary-selector-item${checked ? " summary-selector-item--selected" : ""}`}
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                this.handleToggle(m.uid);
                                            }}
                                        />
                                        <WKAvatar
                                            channel={new Channel(m.uid, ChannelTypePerson)}
                                            className="summary-selector-item-avatar"
                                        />
                                        <div className="summary-selector-item-main">
                                            <div className="summary-selector-item-title">{m.name}</div>
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
