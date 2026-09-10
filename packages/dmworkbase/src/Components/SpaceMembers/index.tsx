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
import "./index.css";

export interface SpaceMembersProps {
    space: Space;
    onClose: () => void;
}

interface SpaceMembersState {
    members: SpaceMember[];
    loading: boolean;
    changing: boolean;
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

    constructor(props: SpaceMembersProps) {
        super(props);
        this.state = {
            members: [],
            loading: false,
            changing: false,
        };
    }

    componentDidMount() {
        this.mounted = true;
        this.loadMembers();
    }

    componentDidUpdate(previousProps: SpaceMembersProps) {
        if (previousProps.space.space_id !== this.props.space.space_id) {
            this.loadMembers();
        }
    }

    componentWillUnmount() {
        this.mounted = false;
        this.requestId++;
    }

    private isCurrentRequest(spaceId: string, requestId: number) {
        return this.mounted && this.props.space.space_id === spaceId && this.requestId === requestId;
    }

    loadMembers = async () => {
        const spaceId = this.props.space.space_id;
        const requestId = ++this.requestId;
        this.changing = false;
        this.setState({ members: [], loading: true, changing: false });
        try {
            const members = await SpaceService.shared.getRoster(spaceId, { maxAgeMs: 0 });
            if (this.isCurrentRequest(spaceId, requestId)) {
                this.setState({ members, loading: false });
            }
        } catch {
            if (this.isCurrentRequest(spaceId, requestId)) {
                this.setState({ loading: false });
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

    handleRemove = async (uid: string) => {
        await this.changeMember(uid);
    };

    handleRoleChange = async (uid: string, role: number) => {
        if (!this.canManageRoles() || (role !== SPACE_ROLE_MEMBER && role !== SPACE_ROLE_ADMIN)) return;
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
        const { space, onClose } = this.props;
        const { members, loading, changing } = this.state;
        const canManageRoles = this.canManageRoles();
        const { t } = this.context;

        return (
            <div className="wk-spacemembers">
                <div className="wk-spacemembers-header">
                    <div className="wk-spacemembers-header-left">
                        <div className="wk-spacemembers-back" onClick={onClose}>
                            ←
                        </div>
                        <span className="wk-spacemembers-title">
                            {t("base.spaceMembers.title", { values: { name: space.name } })}
                        </span>
                    </div>
                    <button className="wk-spacemembers-invite-btn" onClick={this.handleInvite}>
                        {t("base.spaceMembers.invite")}
                    </button>
                </div>
                <div className="wk-spacemembers-list">
                    {loading ? (
                        <div className="wk-spacemembers-loading">
                            {t("base.spaceMembers.loading")}
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
                                                disabled={changing}
                                                onClick={() => this.handleRoleChange(member.uid, SPACE_ROLE_ADMIN)}
                                            >
                                                {t("base.spaceMembers.setAdmin")}
                                            </button>
                                        )}
                                        {canManageRoles && member.role === SPACE_ROLE_ADMIN && (
                                            <button
                                                className="wk-spacemembers-action-btn"
                                                disabled={changing}
                                                onClick={() => this.handleRoleChange(member.uid, SPACE_ROLE_MEMBER)}
                                            >
                                                {t("base.spaceMembers.cancelAdmin")}
                                            </button>
                                        )}
                                        <button
                                            className="wk-spacemembers-action-btn wk-spacemembers-action-danger"
                                            disabled={changing}
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
