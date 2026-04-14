import React, { useState } from "react";
import { WKApp } from "@octo/base";
import { SpaceService } from "@octo/base";
import { Button, Input, Toast } from "@douyinfe/semi-ui";
import "./index.css";

type View = "home" | "join" | "join-confirm" | "create";

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

const ACCENT = "var(--wk-color-primary, #5b6abf)";

const setCurrentSpace = (spaceId: string) => {
    if (spaceId) localStorage.setItem("currentSpaceId", spaceId);
};

export default function JoinSpacePage({ onSuccess }: JoinSpacePageProps) {
    const [view, setView] = useState<View>("home");

    // --- 加入 Space ---
    const [inviteCode, setInviteCode] = useState("");
    const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [joinLoading, setJoinLoading] = useState(false);

    // --- 创建 Space ---
    const [spaceName, setSpaceName] = useState("");
    const [createLoading, setCreateLoading] = useState(false);

    /** 验证邀请码，展示 Space 信息 */
    const handleVerifyCode = async () => {
        const code = inviteCode.trim();
        if (!code) { Toast.warning("请输入邀请码"); return; }
        if (!/^[a-zA-Z0-9_-]+$/.test(code)) { Toast.error("邀请码格式不正确"); return; }
        setVerifyLoading(true);
        try {
            const info = await WKApp.apiClient.get(`space/invite/${code}`);
            setInviteInfo(info);
            setView("join-confirm");
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            if (msg.includes("已满") || msg.includes("SPACE_FULL")) {
                Toast.error("该空间已满，无法加入");
            } else {
                Toast.error("邀请码无效或已过期");
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
                    status === "NEED_APPROVAL" ? "need_approval" : "pending",
                    inviteInfo.invite_code
                );
                return;
            }

            setCurrentSpace(result?.space_id || inviteInfo.space_id);
            Toast.success("已加入 " + inviteInfo.space_name);
            onSuccess();
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            if (msg.includes("已满") || msg.includes("SPACE_FULL")) {
                Toast.error("空间已满，无法加入");
            } else if (msg.includes("已是成员") || msg.includes("already")) {
                setCurrentSpace(inviteInfo.space_id);
                onSuccess();
            } else {
                Toast.error(msg || "加入失败，请重试");
            }
        } finally {
            setJoinLoading(false);
        }
    };

    /** 创建新 Space */
    const handleCreate = async () => {
        const name = spaceName.trim();
        if (!name) { Toast.warning("请输入 Space 名称"); return; }
        if (name.length > 50) { Toast.error("名称不能超过 50 个字符"); return; }
        setCreateLoading(true);
        try {
            const result = await SpaceService.shared.createSpace(name, "");
            setCurrentSpace(result?.space_id);
            Toast.success("Space 创建成功！");
            onSuccess();
        } catch (e: any) {
            const msg = e?.msg || e?.message || "";
            Toast.error(msg || "创建失败，请重试");
        } finally {
            setCreateLoading(false);
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
                            欢迎使用 {WKApp.config.appName || "DMWork"}！
                        </h2>
                        <p className="wk-join-space-subtitle">加入团队或创建新的工作空间开始协作</p>
                        <div className="wk-join-space-actions">
                            <Button
                                type="primary"
                                size="large"
                                className="wk-join-space-btn"
                                onClick={() => setView("join")}
                            >
                                📩 输入邀请码加入
                            </Button>
                            <Button
                                type="secondary"
                                size="large"
                                className="wk-join-space-btn"
                                onClick={() => setView("create")}
                            >
                                ✨ 创建新 Space
                            </Button>
                        </div>
                    </>
                )}

                {/* ── 输入邀请码 ── */}
                {view === "join" && (
                    <>
                        <button className="wk-join-space-back" onClick={() => { setView("home"); setInviteCode(""); }}>
                            ← 返回
                        </button>
                        <h2 className="wk-join-space-title">输入邀请码</h2>
                        <p className="wk-join-space-subtitle">粘贴邀请码以查看并加入团队</p>
                        <Input
                            className="wk-join-space-input"
                            size="large"
                            placeholder="输入邀请码"
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
                            验证邀请码
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
                        <div className="wk-join-space-subtitle">邀请你加入</div>
                        <div className="wk-join-space-members">
                            {inviteInfo.max_users > 0
                                ? `${inviteInfo.member_count} / ${inviteInfo.max_users} 人`
                                : `${inviteInfo.member_count} 位成员`}
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
                                ? "空间已满"
                                : "确认加入"}
                        </Button>
                        <button
                            className="wk-join-space-back wk-join-space-back--bottom"
                            onClick={() => { setView("join"); setInviteInfo(null); }}
                        >
                            ← 重新输入邀请码
                        </button>
                    </>
                )}

                {/* ── 创建 Space ── */}
                {view === "create" && (
                    <>
                        <button className="wk-join-space-back" onClick={() => { setView("home"); setSpaceName(""); }}>
                            ← 返回
                        </button>
                        <h2 className="wk-join-space-title">创建新 Space</h2>
                        <p className="wk-join-space-subtitle">给你的团队起一个名字</p>
                        <Input
                            className="wk-join-space-input"
                            size="large"
                            placeholder="Space 名称（如：研发团队）"
                            value={spaceName}
                            onChange={setSpaceName}
                            onEnterPress={handleCreate}
                            autoFocus
                            maxLength={50}
                            showClear
                        />
                        <Button
                            type="primary"
                            size="large"
                            className="wk-join-space-btn wk-join-space-btn--full"
                            loading={createLoading}
                            onClick={handleCreate}
                        >
                            创建
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
