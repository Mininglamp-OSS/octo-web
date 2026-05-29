import React, { Component } from "react";
import { IconPlus, IconSearch, IconLink } from "@douyinfe/semi-icons";
import { Spin, Toast, Tooltip } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { Space, SpaceService } from "../../Service/SpaceService";
import WKApp from "../../App";
import SpaceItem from "../SpaceItem";
import ActionListItem from "../ActionListItem";
import JoinSpaceModalConnected from "../JoinSpaceModal/JoinSpaceModalConnected";
import { I18nContext } from "../../i18n";
import "./index.css";

export interface SpaceListProps {
    selectedSpaceId?: string;
    onSelect: (space: Space | undefined) => void;
    onCreateClick: () => void;
    /** 外部传入时由父层控制加入弹窗；不传则内部自管 */
    onJoinClick?: () => void;
    onSettingsClick?: (space: Space) => void;
}

interface SpaceListState {
    spaces: Space[];
    loading: boolean;
    showJoinModal: boolean;
    inviteLoading: string;
    inviteCode: string;
    showInviteModal: boolean;
    inviteSpaceName: string;
}

export default class SpaceList extends Component<SpaceListProps, SpaceListState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;
    private unsubscribeRemoteConfig?: () => void;

    constructor(props: SpaceListProps) {
        super(props);
        this.state = {
            spaces: [],
            loading: false,
            showJoinModal: false,
            inviteLoading: "",
            inviteCode: "",
            showInviteModal: false,
            inviteSpaceName: "",
        };
    }

    componentDidMount() {
        this.loadSpaces();
        this.unsubscribeRemoteConfig = WKApp.remoteConfig.addConfigChangeListener(() => {
            this.forceUpdate();
        });
    }

    componentWillUnmount() {
        this.unsubscribeRemoteConfig?.();
    }

    loadSpaces = async (): Promise<Space[]> => {
        this.setState({ loading: true });
        try {
            const spaces = await SpaceService.shared.getMySpaces();
            this.setState({ spaces, loading: false });
            if (spaces.length === 1 && !this.props.selectedSpaceId) {
                this.props.onSelect(spaces[0]);
            }
            return spaces;
        } catch {
            this.setState({ loading: false });
            return this.state.spaces;
        }
    };

    handleInvite = async (space: Space, e: React.MouseEvent) => {
        e.stopPropagation();
        this.setState({ inviteLoading: space.space_id });
        try {
            const resp = await SpaceService.shared.createInvite(space.space_id);
            this.setState({
                inviteCode: resp.invite_code,
                showInviteModal: true,
                inviteSpaceName: space.name,
                inviteLoading: "",
            });
        } catch {
            Toast.error(this.context.t("base.spaceList.createInviteFailed"));
            this.setState({ inviteLoading: "" });
        }
    };

    copyInviteCode = () => {
        navigator.clipboard.writeText(this.state.inviteCode).then(() => {
            Toast.success(this.context.t("base.spaceList.inviteCodeCopied"));
        });
    };

    copyInviteLink = () => {
        const link = `${window.location.origin}/join/${this.state.inviteCode}`;
        navigator.clipboard.writeText(link).then(() => {
            Toast.success(this.context.t("base.spaceList.inviteLinkCopied"));
        });
    };

    render() {
        const { selectedSpaceId, onSelect, onCreateClick, onJoinClick } = this.props;
        const { spaces, loading, showJoinModal, showInviteModal, inviteCode,
                inviteSpaceName, inviteLoading } = this.state;

        const selectedSpace = spaces.find(s => s.space_id === selectedSpaceId);
        const headerLabel = selectedSpace ? selectedSpace.name : "Space";
        const handleJoinEntry = onJoinClick ?? (() => this.setState({ showJoinModal: true }));
        const canCreateSpace = !WKApp.remoteConfig.disableUserCreateSpace;
        const { t } = this.context;

        return (
            <div className="wk-spacelist">
                <div className="wk-spacelist-header">
                    <span className="wk-spacelist-title" title={headerLabel}>{headerLabel}</span>
                </div>

                {/* 加入弹窗（内部自管，父层未传 onJoinClick 时使用） */}
                <JoinSpaceModalConnected
                    visible={showJoinModal}
                    onClose={() => this.setState({ showJoinModal: false })}
                    onSuccess={async (spaceId) => {
                        const spaces = await this.loadSpaces();
                        const space = spaces.find(s => s.space_id === spaceId);
                        if (space) this.props.onSelect(space);
                    }}
                />

                {/* 邀请他人弹窗 */}
                <WKModal
                    title={t("base.spaceList.inviteTitle", { values: { name: inviteSpaceName } })}
                    visible={showInviteModal}
                    onCancel={() => this.setState({ showInviteModal: false, inviteCode: "" })}
                >
                    <div className="wk-spacelist-invite-modal">
                        <div className="wk-spacelist-invite-row">
                            <span className="wk-spacelist-invite-label">
                                {t("base.spaceList.inviteCode")}
                            </span>
                            <code className="wk-spacelist-invite-code">{inviteCode}</code>
                            <button className="wk-spacelist-invite-btn" onClick={this.copyInviteCode}>
                                {t("base.spaceList.copy")}
                            </button>
                        </div>
                        <button className="wk-spacelist-invite-btn wk-spacelist-invite-btn-full" onClick={this.copyInviteLink}>
                            {t("base.spaceList.copyInviteLink")}
                        </button>
                    </div>
                </WKModal>

                {loading ? (
                    <div className="wk-spacelist-loading">
                        <Spin size="small" />
                    </div>
                ) : (
                    <div className="wk-spacelist-items">
                        {spaces.map((space) => (
                            <SpaceItem
                                key={space.space_id}
                                name={space.name}
                                logo={space.logo}
                                meta={space.max_users > 0
                                    ? t("base.spaceList.memberLimit", {
                                        values: { count: space.member_count, max: space.max_users },
                                    })
                                    : t("base.spaceList.memberCount", {
                                        values: { count: space.member_count },
                                    })}
                                selected={selectedSpaceId === space.space_id}
                                onClick={() => onSelect(space)}
                                actions={
                                    <Tooltip content={t("base.spaceList.inviteMembers")} position="right">
                                        <div
                                            className="wk-spacelist-item-action"
                                            onClick={(e) => this.handleInvite(space, e)}
                                        >
                                            {inviteLoading === space.space_id
                                                ? <Spin size="small" />
                                                : <IconLink size="small" />}
                                        </div>
                                    </Tooltip>
                                }
                            />
                        ))}
                    </div>
                )}

                {/* 底部固定入口 */}
                <div className="wk-spacelist-divider" />
                <div className="wk-spacelist-footer-actions">
                    <ActionListItem
                        icon={<IconSearch />}
                        label={t("base.spaceList.joinSpace")}
                        desc={t("base.spaceList.joinSpaceDesc")}
                        variant="join"
                        onClick={handleJoinEntry}
                    />
                    {canCreateSpace && (
                        <ActionListItem
                            icon={<IconPlus />}
                            label={t("base.spaceList.createSpace")}
                            desc={t("base.spaceList.createSpaceDesc")}
                            variant="create"
                            onClick={onCreateClick}
                        />
                    )}
                </div>
            </div>
        );
    }
}
