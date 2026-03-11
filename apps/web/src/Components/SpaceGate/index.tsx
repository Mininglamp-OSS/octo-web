import React, { Component } from "react";
import { WKApp } from "@octo/base";
import { SpaceService } from "@octo/base";
import { Input, Button, Toast, Spin } from "@douyinfe/semi-ui";
import { SpaceCreate } from "@octo/base";

interface SpaceGateState {
    loading: boolean;
    noSpace: boolean;
    inviteCode: string;
    joining: boolean;
    showCreate: boolean;
    showInviteInput: boolean;
}

export default class SpaceGate extends Component<{}, SpaceGateState> {
    state: SpaceGateState = {
        loading: true,
        noSpace: false,
        inviteCode: "",
        joining: false,
        showCreate: false,
        showInviteInput: false,
    };

    private _enterTimer: ReturnType<typeof setTimeout> | null = null;
    private _isEntering = false;
    private _isMounted = false;

    componentDidMount() {
        this._isMounted = true;
        const cached = localStorage.getItem("currentSpaceId");
        if (cached) {
            this.enterSpace(cached);
            return;
        }
        this.checkSpaces();
    }

    componentWillUnmount() {
        this._isMounted = false;
        if (this._enterTimer) {
            clearTimeout(this._enterTimer);
            this._enterTimer = null;
        }
    }

    enterSpace = (spaceId: string) => {
        if (this._isEntering) return;
        this._isEntering = true;

        if (this._enterTimer) {
            clearTimeout(this._enterTimer);
            this._enterTimer = null;
        }

        WKApp.shared.currentSpaceId = spaceId;
        WKApp.shared.spaceChecked = true;
        localStorage.setItem("currentSpaceId", spaceId);
        try { WKApp.shared.notifyListener(); } catch (_) {}

        if (this._isMounted) {
            this.forceUpdate();
        }

        this._enterTimer = setTimeout(() => {
            this._enterTimer = null;
            if (this._isMounted && document.querySelector(".wk-spacegate")) {
                window.location.reload();
            }
        }, 300);
    };

    checkSpaces = async () => {
        try {
            const spaces = await SpaceService.shared.getMySpaces();
            if (spaces.length >= 1) {
                this.enterSpace(spaces[0].space_id);
            } else {
                this.setState({ loading: false, noSpace: true });
            }
        } catch {
            this.setState({ loading: false, noSpace: true });
        }
    };

    joinSpace = async () => {
        const { inviteCode } = this.state;
        if (!inviteCode.trim()) { Toast.warning("请输入邀请码"); return; }
        this.setState({ joining: true });
        try {
            await SpaceService.shared.joinSpace(inviteCode.trim());
            Toast.success("已加入 Space");
            this.checkSpaces();
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            if (msg.includes("已满") || msg.includes("SPACE_FULL")) {
                Toast.error("空间已满，无法加入");
            } else {
                Toast.error("邀请码无效或已过期");
            }
        } finally {
            this.setState({ joining: false });
        }
    };

    render() {
        const { loading, noSpace, inviteCode, joining, showCreate, showInviteInput } = this.state;

        if (loading && !noSpace) {
            return (
                <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
                    <Spin size="large" />
                </div>
            );
        }

        return (
            <div className="wk-spacegate" style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", height: "100vh",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            }}>
                <div style={{
                    background: "white", borderRadius: 16, padding: "48px 40px",
                    textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
                    minWidth: 360, maxWidth: 420, color: "#333333",
                }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>👋</div>
                    <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px" }}>欢迎使用 DMWork！</h2>
                    <p style={{ color: "#888", fontSize: 14, marginBottom: 32 }}>加入团队或创建新的工作空间</p>

                    {!showInviteInput ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <Button type="primary" size="large" style={{ width: "100%", height: 44 }}
                                onClick={() => this.setState({ showInviteInput: true })}>
                                📩 输入邀请码加入团队
                            </Button>
                            <Button type="secondary" size="large" style={{ width: "100%", height: 44 }}
                                onClick={() => this.setState({ showCreate: true })}>
                                ✨ 创建新团队
                            </Button>
                        </div>
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            <Input
                                placeholder="输入邀请码"
                                size="large"
                                value={inviteCode}
                                onChange={(v) => this.setState({ inviteCode: v })}
                                onEnterPress={this.joinSpace}
                            />
                            <Button type="primary" size="large" loading={joining}
                                style={{ width: "100%", height: 44 }}
                                onClick={this.joinSpace}>
                                加入
                            </Button>
                            <Button type="tertiary" size="small"
                                onClick={() => this.setState({ showInviteInput: false })}>
                                ← 返回
                            </Button>
                        </div>
                    )}
                </div>

                <SpaceCreate
                    visible={showCreate}
                    onClose={() => this.setState({ showCreate: false })}
                    onSuccess={() => this.checkSpaces()}
                />
            </div>
        );
    }
}
