import React, { useState } from "react";
import { WKApp, toJoinApprovalStatus, useI18n } from "@octo/base";
import { SpaceService } from "@octo/base";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import "./index.css";

type View = "home" | "join" | "join-confirm";

interface InviteInfo {
    invite_code: string;
    space_id: string;
    space_name: string;
    member_count: number;
    max_users: number;
}

interface JoinSpacePageProps {
    /** 成功加入/创建 Space 后调用，外层负责触发 callOnLogin() */
    onSuccess: () => void;
}

const ACCENT = "var(--wk-color-primary, #1C1C23)";

const setCurrentSpace = (spaceId: string) => {
    if (spaceId) localStorage.setItem("currentSpaceId", spaceId);
};

export default function JoinSpacePage({ onSuccess }: JoinSpacePageProps) {
    const { t } = useI18n();
    const [view, setView] = useState<View>("home");

    // --- 加入 Space ---
    const [inviteCode, setInviteCode] = useState("");
    const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [joinLoading, setJoinLoading] = useState(false);

    /** 验证邀请码，展示 Space 信息 */
    const handleVerifyCode = async () => {
        const code = inviteCode.trim();
        if (!code) { Toast.warning(t("app.joinSpace.validation.inviteRequired")); return; }
        if (!/^[a-zA-Z0-9_-]+$/.test(code)) { Toast.error(t("app.joinSpace.validation.inviteInvalidFormat")); return; }
        setVerifyLoading(true);
        try {
            const info = await WKApp.apiClient.get(`space/invite/${code}`);
            setInviteInfo(info);
            setView("join-confirm");
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            if (msg.includes(t("app.invite.serverTerms.full", { locale: "zh-CN" })) || msg.includes("SPACE_FULL")) {
                Toast.error(t("app.joinSpace.spaceFullCannotJoin"));
            } else {
                Toast.error(t("app.joinSpace.inviteInvalidOrExpired"));
            }
        } finally {
            setVerifyLoading(false);
        }
    };

    /** 确认加入 Space */
    const handleJoin = async () => {
        if (!inviteInfo) return;
        setJoinLoading(true);
        try {
            const result: any = await SpaceService.shared.joinSpace(inviteInfo.invite_code);
            const status = result?.status;

            if (status === "NEED_APPROVAL" || status === "PENDING") {
                // 审批状态：先调 onSuccess 离开 JoinSpacePage，再触发钩子渲染审批结果页
                // 顺序保证 Layout 先切出 JoinSpacePage，再渲染 JoinApprovalResult，避免中间态
                onSuccess();
                WKApp.endpoints.onJoinApproval(
                    toJoinApprovalStatus(status),
                    inviteInfo.invite_code
                );
                return;
            }

            setCurrentSpace(result?.space_id || inviteInfo.space_id);
            Toast.success(t("app.joinSpace.joinedSpace", { values: { spaceName: inviteInfo.space_name } }));
            onSuccess();
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            if (msg.includes(t("app.invite.serverTerms.full", { locale: "zh-CN" })) || msg.includes("SPACE_FULL")) {
                Toast.error(t("app.invite.spaceFullCannotJoin"));
            } else if (msg.includes(t("app.joinSpace.serverTerms.alreadyMember", { locale: "zh-CN" })) || msg.includes("already")) {
                setCurrentSpace(inviteInfo.space_id);
                onSuccess();
            } else {
                Toast.error(msg || t("app.joinSpace.joinFailedRetry"));
            }
        } finally {
            setJoinLoading(false);
        }
    };

    const colors = ["#667eea", "#764ba2", "#f093fb", "#4facfe", "#43e97b", "#fa709a"];
    const spaceColor = inviteInfo
        ? colors[inviteInfo.space_name.charCodeAt(0) % colors.length]
        : ACCENT;

    return (
        <div className="wk-join-space">
            <div className="wk-join-space-card">
                {/* ── 首页：选择路径 ── */}
                {view === "home" && (
                    <>
                        <div className="wk-join-space-emoji">👋</div>
                        <h2 className="wk-join-space-title">
                            {t("app.joinSpace.welcome", { values: { appName: WKApp.config.appName || "DMWork" } })}
                        </h2>
                        <p className="wk-join-space-subtitle">{t("app.joinSpace.homeSubtitle")}</p>
                        <div className="wk-join-space-actions">
                            <Button
                                type="primary"
                                size="large"
                                className="wk-join-space-btn"
                                onClick={() => setView("join")}
                            >
                                📩 {t("app.joinSpace.inputInviteJoin")}
                            </Button>
                        </div>
                    </>
                )}

                {/* ── 输入邀请码 ── */}
                {view === "join" && (
                    <>
                        <button className="wk-join-space-back" onClick={() => { setView("home"); setInviteCode(""); }}>
                            ← {t("app.common.back")}
                        </button>
                        <h2 className="wk-join-space-title">{t("app.joinSpace.inputInviteTitle")}</h2>
                        <p className="wk-join-space-subtitle">{t("app.joinSpace.inputInviteSubtitle")}</p>
                        <Input
                            className="wk-join-space-input"
                            size="large"
                            placeholder={t("app.joinSpace.inputInvitePlaceholder")}
                            value={inviteCode}
                            onChange={setInviteCode}
                            onEnterPress={handleVerifyCode}
                            autoFocus
                        />
                        <Button
                            type="primary"
                            size="large"
                            className="wk-join-space-btn wk-join-space-btn--full"
                            loading={verifyLoading}
                            onClick={handleVerifyCode}
                        >
                            {t("app.joinSpace.verifyInvite")}
                        </Button>
                    </>
                )}

                {/* ── 确认加入 ── */}
                {view === "join-confirm" && inviteInfo && (
                    <>
                        <div
                            className="wk-join-space-icon"
                            style={{ backgroundColor: spaceColor }}
                        >
                            {inviteInfo.space_name.charAt(0)}
                        </div>
                        <div className="wk-join-space-name">{inviteInfo.space_name}</div>
                        <div className="wk-join-space-subtitle">{t("app.invite.inviteYouJoin")}</div>
                        <div className="wk-join-space-members">
                            {inviteInfo.max_users > 0
                                ? t("app.joinSpace.memberCountWithLimit", { values: { count: inviteInfo.member_count, max: inviteInfo.max_users } })
                                : t("app.invite.memberCount", { values: { count: inviteInfo.member_count } })}
                        </div>
                        <Button
                            type="primary"
                            size="large"
                            className="wk-join-space-btn wk-join-space-btn--full"
                            loading={joinLoading}
                            disabled={
                                inviteInfo.max_users > 0 &&
                                inviteInfo.member_count >= inviteInfo.max_users
                            }
                            onClick={handleJoin}
                        >
                            {inviteInfo.max_users > 0 &&
                            inviteInfo.member_count >= inviteInfo.max_users
                                ? t("app.invite.spaceFull")
                                : t("app.joinSpace.confirmJoin")}
                        </Button>
                        <button
                            className="wk-join-space-back wk-join-space-back--bottom"
                            onClick={() => { setView("join"); setInviteInfo(null); }}
                        >
                            ← {t("app.joinSpace.reenterInvite")}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
