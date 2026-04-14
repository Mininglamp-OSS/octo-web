import React, { Component } from "react";
import { WKApp } from "@octo/base";
import type { JoinSpaceStatus } from "@octo/base";
import { Button, Spin, Toast } from "@douyinfe/semi-ui";
import "./index.css";

interface InviteLandingProps {
    inviteCode: string;
}

interface InviteInfo {
    invite_code: string;
    space_id: string;
    space_name: string;
    member_count: number;
    max_users: number;
}

interface InviteLandingState {
    loading: boolean;
    info?: InviteInfo;
    error?: string;
    joining: boolean;
}

export default class InviteLanding extends Component<InviteLandingProps, InviteLandingState> {
    state: InviteLandingState = {
        loading: true,
        joining: false,
    };

    private isUnmounted = false;
    private joinInProgress = false;
    private redirecting = false;

    componentDidMount() {
        this.loadInviteInfo();
    }

    componentWillUnmount() {
        this.isUnmounted = true;
    }

    private safeSetState(state: Partial<InviteLandingState>) {
        if (!this.isUnmounted) {
            this.setState(state as Pick<InviteLandingState, keyof InviteLandingState>);
        }
    }

    private redirectToClean() {
        if (this.redirecting) return;
        this.redirecting = true;
        localStorage.removeItem("pendingInviteCode");
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.location.href = url.toString();
    }

    async loadInviteInfo() {
        try {
            const resp = await fetch(`${WKApp.apiClient.config.apiURL}space/invite/${this.props.inviteCode}`);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                this.setState({ loading: false, error: err.msg || "邀请码无效" });
                return;
            }
            const info = await resp.json();
            this.setState({ loading: false, info });
        } catch (e) {
            this.setState({ loading: false, error: "网络错误" });
        }
    }

    private findToken(): string | undefined {
        // 先试 WKApp 的 token
        if (WKApp.loginInfo.token) return WKApp.loginInfo.token;
        // fallback: 遍历 localStorage 找 token（邀请链接没有 sid 参数时 WKApp 读不到）
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("token") && key !== "tokenCallback") {
                const val = localStorage.getItem(key);
                if (val && val.length > 10) return val;
            }
        }
        return undefined;
    }

    private findSid(): string {
        // 从 localStorage 的 token key 提取 sid（key 格式: "token{sid}"）
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("token") && key !== "tokenCallback") {
                const val = localStorage.getItem(key);
                if (val && val.length > 10) return key.substring(5); // "token".length = 5
            }
        }
        return "";
    }

    async handleJoin() {
        if (this.joinInProgress) return;
        this.joinInProgress = true;
        this.safeSetState({ joining: true });
        try {
            const token = this.findToken();
            const apiUrl = WKApp.apiClient.config.apiURL?.replace(/\/+$/, '');
            const resp = await fetch(`${apiUrl}/space/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { token } : {}) },
                body: JSON.stringify({ invite_code: this.props.inviteCode }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.msg || "加入失败");
            }
            const result = await resp.json().catch(() => ({}));
            const status: JoinSpaceStatus | undefined = result?.status;

            if (status === "NEED_APPROVAL" || status === "PENDING") {
                // 审批状态：触发全局钩子，Layout 统一渲染审批结果页
                WKApp.endpoints.onJoinApproval(
                    status === "NEED_APPROVAL" ? "need_approval" : "pending",
                    this.props.inviteCode
                );
                return;
            }

            Toast.success("加入成功！");
            const spaceId = this.state.info?.space_id || result?.space_id;
            if (spaceId) {
                localStorage.setItem('currentSpaceId', spaceId);
            }
            // 跳转回主界面，带上正确的 sid
            const sid = this.findSid();
            const basePath = window.location.pathname.replace(/\/+$/, '');
            window.location.href = `${window.location.origin}${basePath}/${sid ? `?sid=${sid}` : ''}`;
        } catch (e: any) {
            const msg = e?.message || "";
            if (msg.includes("已满") || msg.includes("SPACE_FULL")) {
                Toast.error("空间已满，无法加入");
            } else {
                Toast.error(msg || "加入失败");
            }
            this.safeSetState({ joining: false });
        } finally {
            this.joinInProgress = false;
        }
    }

    handleGoLogin() {
        // 保存邀请码到 localStorage，登录成功后 onLogin 回调会读取并自动加入
        localStorage.setItem("pendingInviteCode", this.props.inviteCode);
        // 跳转到登录页，保留 invite 参数让登录页显示注册入口
        // 添加 action=login 参数让 Layout 跳过 InviteLanding 渲染
        // 使用动态 basePath，避免硬编码 /web 导致部署路径不匹配
        const basePath = window.location.pathname.replace(/\/+$/, '');
        window.location.href = `${window.location.origin}${basePath}/?invite=${encodeURIComponent(this.props.inviteCode)}&action=login`;
    }

    render() {
        const { loading, info, error, joining } = this.state;
        const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a'];
        const isLoggedIn = WKApp.shared.isLogined();

        if (loading) {
            return <div className="invite-landing"><Spin size="large" /></div>;
        }

        if (error || !info) {
            return (
                <div className="invite-landing">
                    <div className="invite-landing-card">
                        <div className="invite-landing-error">❌ {error || "邀请码无效"}</div>
                        <Button onClick={() => {
                            const url = new URL(window.location.href);
                            url.searchParams.delete("invite");
                            window.location.href = url.toString();
                        }}>返回</Button>
                    </div>
                </div>
            );
        }

        const colorIndex = info.space_name.charCodeAt(0) % colors.length;

        return (
            <div className="invite-landing">
                <div className="invite-landing-card">
                    <div className="invite-landing-icon" style={{ backgroundColor: colors[colorIndex] }}>
                        {info.space_name.charAt(0)}
                    </div>
                    <div className="invite-landing-name">{info.space_name}</div>
                    <div className="invite-landing-subtitle">邀请你加入</div>
                    <div className="invite-landing-members">
                        {info.max_users > 0 ? `${info.member_count}/${info.max_users} 人` : `${info.member_count} 位成员`}
                    </div>

                    {isLoggedIn ? (
                        <Button type="primary" size="large" loading={joining}
                            className="invite-landing-btn"
                            disabled={info.max_users > 0 && info.member_count >= info.max_users}
                            onClick={() => this.handleJoin()}>
                            {info.max_users > 0 && info.member_count >= info.max_users ? "空间已满" : "加入 Space"}
                        </Button>
                    ) : (
                        <>
                            <div className="invite-landing-hint">登录或注册后加入该团队</div>
                            <Button type="primary" size="large"
                                className="invite-landing-btn" onClick={() => this.handleGoLogin()}>
                                去登录
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    }
}
