import React, { Component } from "react";
import { WKApp } from "@octo/base";
import { Button, Input, Spin, Toast, Divider } from "@douyinfe/semi-ui";
import "./index.css";

interface InviteLandingProps {
    inviteCode: string;
}

interface InviteInfo {
    invite_code: string;
    space_id: string;
    space_name: string;
    member_count: number;
}

interface InviteLandingState {
    loading: boolean;
    info?: InviteInfo;
    error?: string;
    joining: boolean;
    // login form
    loginUsername: string;
    loginPassword: string;
    loginLoading: boolean;
    // register form
    regUsername: string;
    regPassword: string;
    regLoading: boolean;
}

export default class InviteLanding extends Component<InviteLandingProps, InviteLandingState> {
    state: InviteLandingState = {
        loading: true, joining: false,
        loginUsername: '', loginPassword: '', loginLoading: false,
        regUsername: '', regPassword: '', regLoading: false,
    };

    private isUnmounted = false;
    private loginInProgress = false;
    private registerInProgress = false;
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

    async handleJoin() {
        if (this.joinInProgress) return;
        this.joinInProgress = true;
        this.safeSetState({ joining: true });
        try {
            await WKApp.apiClient.post(`/space/join`, { invite_code: this.props.inviteCode });
            Toast.success("加入成功！");
            const spaceId = this.state.info?.space_id;
            if (spaceId) {
                localStorage.setItem('currentSpaceId', spaceId);
                WKApp.shared.currentSpaceId = spaceId;
            }
            this.redirectToClean();
        } catch (e: any) {
            Toast.error(e?.msg || "加入失败");
            this.safeSetState({ joining: false });
        } finally {
            this.joinInProgress = false;
        }
    }

    async handleLogin() {
        if (this.loginInProgress) return;
        this.loginInProgress = true;
        const { loginUsername, loginPassword } = this.state;
        if (!loginUsername || !loginPassword) { Toast.warning("请输入用户名和密码"); this.loginInProgress = false; return; }
        this.safeSetState({ loginLoading: true });
        try {
            const resp = await fetch(`${WKApp.apiClient.config.apiURL}user/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: loginUsername, password: loginPassword, flag: 1 }),
            });
            const data = await resp.json();
            if (!resp.ok) { Toast.error(data.msg || "登录失败"); this.safeSetState({ loginLoading: false }); return; }
            // Save login info
            WKApp.loginInfo.uid = data.uid;
            WKApp.loginInfo.token = data.token;
            WKApp.loginInfo.name = data.name;
            WKApp.loginInfo.shortNo = data.short_no;
            WKApp.loginInfo.save();
            Toast.success("登录成功");
            // Join space then reload
            await this.joinAfterAuth();
        } catch (e) {
            Toast.error("网络错误");
            this.safeSetState({ loginLoading: false });
        } finally {
            this.loginInProgress = false;
        }
    }

    async handleRegister() {
        if (this.registerInProgress) return;
        this.registerInProgress = true;
        const { regUsername, regPassword } = this.state;
        if (!regUsername || !regPassword) { Toast.warning("请输入用户名和密码"); this.registerInProgress = false; return; }
        this.safeSetState({ regLoading: true });
        try {
            // Register using usernameregister API (no code required)
            const regResp = await fetch(`${WKApp.apiClient.config.apiURL}user/usernameregister`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: regUsername, name: regUsername, password: regPassword, flag: 1 }),
            });
            const regData = await regResp.json();
            if (!regResp.ok) { Toast.error(regData.msg || "注册失败"); this.safeSetState({ regLoading: false }); return; }
            // 注册响应已包含 token，直接使用，不要再调 login（避免 token 竞态）
            const userData = regData.data || regData;
            WKApp.loginInfo.uid = userData.uid;
            WKApp.loginInfo.token = userData.token;
            WKApp.loginInfo.name = userData.name;
            WKApp.loginInfo.shortNo = userData.short_no;
            WKApp.loginInfo.save();
            Toast.success("注册成功");
            await this.joinAfterAuth();
        } catch (e) {
            Toast.error("网络错误");
            this.safeSetState({ regLoading: false });
        } finally {
            this.registerInProgress = false;
        }
    }

    async joinAfterAuth() {
        try {
            // Use raw fetch with token since WKApp.apiClient may not have updated token yet
            const resp = await fetch(`${WKApp.apiClient.config.apiURL}space/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'token': WKApp.loginInfo.token || '' },
                body: JSON.stringify({ invite_code: this.props.inviteCode }),
            });
            if (!resp.ok) {
                Toast.error("加入 Space 失败");
                return;
            }
        } catch (e) {
            Toast.error("网络错误，加入失败");
            return;
        }
        // 设置 currentSpaceId，避免刷新后 SpaceGate 竞态导致选择器不显示
        const spaceId = this.state.info?.space_id;
        if (spaceId) {
            localStorage.setItem('currentSpaceId', spaceId);
            WKApp.shared.currentSpaceId = spaceId;
        }
        this.redirectToClean();
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
                    <div className="invite-landing-members">{info.member_count} 位成员</div>

                    {isLoggedIn ? (
                        <Button type="primary" size="large" loading={joining}
                            className="invite-landing-btn" onClick={() => this.handleJoin()}>
                            加入 Space
                        </Button>
                    ) : (
                        <>
                            <Divider>已有账号？</Divider>
                            <div className="invite-landing-form">
                                <Input placeholder="用户名" value={this.state.loginUsername}
                                    onChange={v => this.setState({ loginUsername: v })} />
                                <Input placeholder="密码" type="password" value={this.state.loginPassword}
                                    onChange={v => this.setState({ loginPassword: v })} />
                                <Button type="primary" size="large" loading={this.state.loginLoading}
                                    className="invite-landing-btn" onClick={() => this.handleLogin()}>
                                    登录并加入
                                </Button>
                            </div>
                            <Divider>新用户</Divider>
                            <div className="invite-landing-form">
                                <Input placeholder="用户名" value={this.state.regUsername}
                                    onChange={v => this.setState({ regUsername: v })} />
                                <Input placeholder="密码" type="password" value={this.state.regPassword}
                                    onChange={v => this.setState({ regPassword: v })} />
                                <Button type="secondary" size="large" loading={this.state.regLoading}
                                    className="invite-landing-btn" onClick={() => this.handleRegister()}>
                                    注册并加入
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        );
    }
}
