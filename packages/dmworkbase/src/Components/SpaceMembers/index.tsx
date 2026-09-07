import React, { Component } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { SpaceMember, SpaceService, Space } from "../../Service/SpaceService";
import WKApp from "../../App";
import { I18nContext } from "../../i18n";
import { Loading } from "@octo/ui";
import "./index.css";

export interface SpaceMembersProps {
    space: Space;
    onClose: () => void;
}

interface SpaceMembersState {
    members: SpaceMember[];
    loading: boolean;
}

const RoleColors: Record<number, string> = {
    1: "#fa709a",
    2: "#667eea",
    3: "#999",
};

export default class SpaceMembers extends Component<SpaceMembersProps, SpaceMembersState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    constructor(props: SpaceMembersProps) {
        super(props);
        this.state = {
            members: [],
            loading: false,
        };
    }

    componentDidMount() {
        this.loadMembers();
    }

    loadMembers = async () => {
        this.setState({ loading: true });
        try {
            const members = await SpaceService.shared.getMembers(this.props.space.space_id);
            this.setState({ members, loading: false });
        } catch {
            this.setState({ loading: false });
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
        try {
            await SpaceService.shared.removeMembers(this.props.space.space_id, [uid]);
            this.setState({ members: this.state.members.filter((m) => m.uid !== uid) });
            Toast.success(this.context.t("base.spaceMembers.removed"));
        } catch {
            Toast.error(this.context.t("base.spaceMembers.removeFailed"));
        }
    };

    handleRoleChange = async (uid: string, role: number) => {
        try {
            await SpaceService.shared.updateMemberRole(this.props.space.space_id, uid, role);
            this.setState({
                members: this.state.members.map((m) =>
                    m.uid === uid ? { ...m, role } : m
                ),
            });
            Toast.success(this.context.t("base.spaceMembers.roleUpdated"));
        } catch {
            Toast.error(this.context.t("base.spaceMembers.roleUpdateFailed"));
        }
    };

    isAdmin() {
        return this.props.space.role <= 2;
    }

    roleLabel(role: number) {
        const { t } = this.context;
        if (role === 1) return t("base.spaceMembers.creator");
        if (role === 2) return t("base.spaceMembers.admin");
        return t("base.spaceMembers.member");
    }

    render() {
        const { space, onClose } = this.props;
        const { members, loading } = this.state;
        const myUid = WKApp.loginInfo.uid;
        const isAdmin = this.isAdmin();
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
                            <Loading text={t("base.spaceMembers.loading")} layout="vertical" />
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
                                {isAdmin && member.uid !== myUid && member.role !== 1 && (
                                    <div className="wk-spacemembers-item-actions">
                                        {member.role === 3 && (
                                            <button
                                                className="wk-spacemembers-action-btn"
                                                onClick={() => this.handleRoleChange(member.uid, 2)}
                                            >
                                                {t("base.spaceMembers.setAdmin")}
                                            </button>
                                        )}
                                        {member.role === 2 && (
                                            <button
                                                className="wk-spacemembers-action-btn"
                                                onClick={() => this.handleRoleChange(member.uid, 3)}
                                            >
                                                {t("base.spaceMembers.cancelAdmin")}
                                            </button>
                                        )}
                                        <button
                                            className="wk-spacemembers-action-btn wk-spacemembers-action-danger"
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
