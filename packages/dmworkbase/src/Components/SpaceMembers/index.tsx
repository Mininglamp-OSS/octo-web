import React, { Component } from "react";
import { Toast } from "@douyinfe/semi-ui";
import {
    isSpaceOwner,
    SPACE_ROLE_ADMIN,
    SPACE_ROLE_MEMBER,
    SPACE_ROLE_OWNER,
    SpaceMember,
    SpaceService,
    Space,
} from "../../Service/SpaceService";
import WKApp from "../../App";
import { I18nContext } from "../../i18n";
import { wkConfirm } from "../WKModal";
import WKButton from "../WKButton";
import "./index.css";

export interface SpaceMembersProps {
    space: Space;
    onClose: () => void;
}

interface SpaceMembersState {
    members: SpaceMember[];
    loading: boolean;
    changing: boolean;
    confirming: boolean;
    loadError: boolean;
}

interface RemovalConfirmation {
    accepted: boolean;
    dialog?: ReturnType<typeof wkConfirm>;
}

const RoleColors: Record<number, string> = {
    [SPACE_ROLE_OWNER]: "#fa709a",
    [SPACE_ROLE_ADMIN]: "#667eea",
    [SPACE_ROLE_MEMBER]: "#999",
};

export default class SpaceMembers extends Component<SpaceMembersProps, SpaceMembersState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;
    private mounted = false;
    private requestId = 0;
    private changing = false;
    private removalConfirmation?: RemovalConfirmation;

    constructor(props: SpaceMembersProps) {
        super(props);
        this.state = {
            members: [],
            loading: false,
            changing: false,
            confirming: false,
            loadError: false,
        };
    }

    componentDidMount() {
        this.mounted = true;
        this.loadMembers();
    }

    componentDidUpdate(previousProps: SpaceMembersProps) {
        if (previousProps.space.space_id !== this.props.space.space_id) {
            this.loadMembers();
        } else if (previousProps.space.role !== this.props.space.role) {
            this.dismissRemovalConfirmation();
        }
    }

    componentWillUnmount() {
        this.mounted = false;
        this.requestId++;
        this.dismissRemovalConfirmation();
    }

    private isCurrentRequest(spaceId: string, requestId: number) {
        return this.mounted && this.props.space.space_id === spaceId && this.requestId === requestId;
    }

    loadMembers = async () => {
        this.dismissRemovalConfirmation();
        const spaceId = this.props.space.space_id;
        const requestId = ++this.requestId;
        this.changing = false;
        this.setState({ members: [], loading: true, changing: false, loadError: false });
        try {
            const members = await SpaceService.shared.getRoster(spaceId, { maxAgeMs: 0 });
            if (this.isCurrentRequest(spaceId, requestId)) {
                this.setState({ members, loading: false });
            }
        } catch {
            if (this.isCurrentRequest(spaceId, requestId)) {
                this.setState({ loading: false, loadError: true });
            }
        }
    };

    handleInvite = async () => {
        try {
            const resp = await SpaceService.shared.createInvite(this.props.space.space_id);
            navigator.clipboard.writeText(resp.invite_url).then(() => {
                Toast.success(this.context.t("base.spaceMembers.inviteCopied"));
            });
        } catch {
            Toast.error(this.context.t("base.spaceMembers.inviteFailed"));
        }
    };

    private finishRemovalConfirmation(confirmation: RemovalConfirmation) {
        if (this.removalConfirmation !== confirmation) return;
        this.removalConfirmation = undefined;
        if (this.mounted) this.setState({ confirming: false });
    }

    private dismissRemovalConfirmation() {
        const confirmation = this.removalConfirmation;
        if (!confirmation) return;
        this.finishRemovalConfirmation(confirmation);
        confirmation.dialog?.destroy();
    }

    handleClose = () => {
        if (this.changing) return;
        this.requestId++;
        this.dismissRemovalConfirmation();
        this.props.onClose();
    };

    handleRemove = (uid: string) => {
        const target = this.state.members.find((member) => member.uid === uid);
        if (!this.mounted || this.state.loading || this.changing || this.removalConfirmation || !target || !this.canRemoveMember(target)) return;
        const { space_id: spaceId, role: operatorRole } = this.props.space;
        const requestId = this.requestId;
        const activeSpaceId = WKApp.shared.currentSpaceId;
        if (activeSpaceId && activeSpaceId !== spaceId) return;
        const session = WKApp.loginInfo;
        const operatorUid = session.uid;
        const sessionToken = session.token;
        const targetRole = target.role;
        const confirmation: RemovalConfirmation = { accepted: false };
        this.removalConfirmation = confirmation;
        this.setState({ confirming: true });
        const { t } = this.context;
        confirmation.dialog = wkConfirm({
            title: t("base.spaceMembers.removeTitle"),
            content: t("base.spaceMembers.removeContent", { values: { name: target.name || uid } }),
            okType: "danger",
            okText: t("base.spaceMembers.remove"),
            cancelText: t("base.common.cancel"),
            maskClosable: false,
            closeOnEsc: false,
            onCancel: () => {
                if (!confirmation.accepted) this.finishRemovalConfirmation(confirmation);
            },
            onOk: async () => {
                if (this.removalConfirmation !== confirmation || confirmation.accepted) return;
                confirmation.accepted = true;
                try {
                    const currentTarget = this.state.members.find((member) => member.uid === uid);
                    if (!this.isCurrentRequest(spaceId, requestId)
                        || WKApp.shared.currentSpaceId !== activeSpaceId
                        || WKApp.loginInfo !== session || session.uid !== operatorUid || session.token !== sessionToken
                        || this.props.space.role !== operatorRole
                        || !currentTarget || currentTarget.role !== targetRole || !this.canRemoveMember(currentTarget)) return;
                    await this.changeMember(uid);
                } finally {
                    this.finishRemovalConfirmation(confirmation);
                }
            },
        });
    };

    handleRoleChange = async (uid: string, role: number) => {
        if (this.removalConfirmation || !this.canManageRoles() || (role !== SPACE_ROLE_MEMBER && role !== SPACE_ROLE_ADMIN)) return;
        await this.changeMember(uid, role);
    };

    private changeMember = async (uid: string, role?: number) => {
        const target = this.state.members.find((member) => member.uid === uid);
        if (!this.mounted || this.state.loading || this.changing || !target || !this.canRemoveMember(target)) return;
        const spaceId = this.props.space.space_id;
        const requestId = ++this.requestId;
        const failureKey = role === undefined ? "base.spaceMembers.removeFailed" : "base.spaceMembers.roleUpdateFailed";
        this.changing = true;
        this.setState({ changing: true });
        try {
            if (role === undefined) await SpaceService.shared.removeMembers(spaceId, [uid]);
            else await SpaceService.shared.updateMemberRole(spaceId, uid, role);
            if (!this.isCurrentRequest(spaceId, requestId)) return;
            // The server can skip a forbidden target and still return OK. The
            // service invalidates its roster on writes; verify the full fresh roster.
            const members = await SpaceService.shared.getRoster(spaceId, { maxAgeMs: 0 });
            if (!this.isCurrentRequest(spaceId, requestId)) return;
            this.setState({ members });
            const updatedTarget = members.find((member) => member.uid === uid);
            const confirmed = role === undefined ? !updatedTarget : updatedTarget?.role === role;
            if (confirmed) {
                Toast.success(this.context.t(role === undefined ? "base.spaceMembers.removed" : "base.spaceMembers.roleUpdated"));
            } else {
                Toast.error(this.context.t(failureKey));
            }
        } catch {
            if (this.isCurrentRequest(spaceId, requestId)) Toast.error(this.context.t(failureKey));
        } finally {
            if (this.isCurrentRequest(spaceId, requestId)) {
                this.changing = false;
                this.setState({ changing: false });
            }
        }
    };

    canRemoveMember(member: SpaceMember) {
        const myUid = WKApp.loginInfo.uid;
        if (!myUid || member.uid === myUid) return false;
        if (this.props.space.role === SPACE_ROLE_OWNER) {
            return member.role === SPACE_ROLE_MEMBER || member.role === SPACE_ROLE_ADMIN;
        }
        return this.props.space.role === SPACE_ROLE_ADMIN && member.role === SPACE_ROLE_MEMBER;
    }

    canManageRoles() {
        return isSpaceOwner(this.props.space.role);
    }

    roleLabel(role: number) {
        const { t } = this.context;
        if (role === SPACE_ROLE_OWNER) return t("base.spaceMembers.creator");
        if (role === SPACE_ROLE_ADMIN) return t("base.spaceMembers.admin");
        return t("base.spaceMembers.member");
    }

    render() {
        const { space } = this.props;
        const { members, loading, changing, confirming, loadError } = this.state;
        const busy = changing || confirming;
        const canManageRoles = this.canManageRoles();
        const { t } = this.context;

        return (
            <div className="wk-spacemembers">
                <div className="wk-spacemembers-header">
                    <div className="wk-spacemembers-header-left">
                        <div className="wk-spacemembers-back" aria-disabled={changing} onClick={this.handleClose}>
                            ←
                        </div>
                        <span className="wk-spacemembers-title">
                            {t("base.spaceMembers.title", { values: { name: space.name } })}
                        </span>
                    </div>
                    <button className="wk-spacemembers-invite-btn" disabled={busy} onClick={this.handleInvite}>
                        {t("base.spaceMembers.invite")}
                    </button>
                </div>
                <div className="wk-spacemembers-list">
                    {loading ? (
                        <div className="wk-spacemembers-loading">
                            {t("base.spaceMembers.loading")}
                        </div>
                    ) : loadError ? (
                        <div className="wk-spacemembers-loading" role="alert">
                            <p>{t("base.spaceMembers.loadFailed")}</p>
                            <WKButton onClick={this.loadMembers}>{t("base.spaceMembers.retry")}</WKButton>
                        </div>
                    ) : (
                        members.map((member) => (
                            <div key={member.uid} className="wk-spacemembers-item">
                                <div className="wk-spacemembers-item-left">
                                    <img
                                        className="wk-spacemembers-item-avatar"
                                        alt=""
                                        src={member.avatar || WKApp.shared.avatarUser(member.uid)}
                                    />
                                    <div className="wk-spacemembers-item-info">
                                        <span className="wk-spacemembers-item-name">{member.name}</span>
                                        <span
                                            className="wk-spacemembers-item-role"
                                            style={{ color: RoleColors[member.role] }}
                                        >
                                            {this.roleLabel(member.role)}
                                        </span>
                                    </div>
                                </div>
                                {this.canRemoveMember(member) && (
                                    <div className="wk-spacemembers-item-actions">
                                        {canManageRoles && member.role === SPACE_ROLE_MEMBER && (
                                            <button
                                                className="wk-spacemembers-action-btn"
                                                disabled={busy}
                                                onClick={() => this.handleRoleChange(member.uid, SPACE_ROLE_ADMIN)}
                                            >
                                                {t("base.spaceMembers.setAdmin")}
                                            </button>
                                        )}
                                        {canManageRoles && member.role === SPACE_ROLE_ADMIN && (
                                            <button
                                                className="wk-spacemembers-action-btn"
                                                disabled={busy}
                                                onClick={() => this.handleRoleChange(member.uid, SPACE_ROLE_MEMBER)}
                                            >
                                                {t("base.spaceMembers.cancelAdmin")}
                                            </button>
                                        )}
                                        <button
                                            className="wk-spacemembers-action-btn wk-spacemembers-action-danger"
                                            disabled={busy}
                                            onClick={() => this.handleRemove(member.uid)}
                                        >
                                            {t("base.spaceMembers.remove")}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    }
}
