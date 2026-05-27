import React, { Component } from "react";
import { WKApp, WKBase, Provider, ErrorBoundary, t } from "@octo/base"
import { listen } from '@tauri-apps/api/event'
import { MainPage } from "../Pages/Main";
import SpaceGate from "../Components/SpaceGate";
import { Notification as NotificationUI, Button } from '@douyinfe/semi-ui';
import { checkUpdate, installUpdate, UpdateManifest } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { os } from "@tauri-apps/api";
import { getSid, getQueryParam, computeAndSaveJoinSuccess } from "@octo/base";
import type { JoinApprovalStatus } from "@octo/base";
import { toJoinApprovalStatus } from "@octo/base";
import InviteLanding from "../Components/InviteLanding";
import JoinSpacePage from "../Components/JoinSpacePage";
import JoinApprovalResult from "../Components/JoinApprovalResult";

interface AppLayoutState {
    showJoinSpace: boolean;
    joinApproval?: { status: JoinApprovalStatus; inviteCode: string };
}

export default class AppLayout extends Component<{}, AppLayoutState> {
    state: AppLayoutState = { showJoinSpace: false };

    onLogin!: () => void
    onNeedJoinSpace!: () => void
    onJoinApproval!: (status: JoinApprovalStatus, inviteCode: string) => void
    private _spaceChecked = false; // 冷启动 Space 检测只跑一次

    componentDidMount() {
        // Wave 2: 无 Space 时触发 JoinSpacePage 覆盖层
        this.onNeedJoinSpace = () => {
            this.setState({ showJoinSpace: true });
        };
        WKApp.endpoints.addOnNeedJoinSpace(this.onNeedJoinSpace);

        // 审批结果统一渲染：任何入口 join 返回 NEED_APPROVAL/PENDING 都走这里
        this.onJoinApproval = (status, inviteCode) => {
            this.setState({ joinApproval: { status, inviteCode } });
        };
        WKApp.endpoints.addOnJoinApproval(this.onJoinApproval);

        // T5: 冷启动已登录检测 — 用户直接打开 App 恢复登录态时，检查是否有 Space
        if (WKApp.shared.isLogined()) {
            this.checkSpaceOnColdStart();
        }

        this.onLogin = () => {
            try { Notification.requestPermission() } catch(_) {} // 请求通知权限（iOS 不支持，忽略错误）
            // 计算 app basePath：
            // 1) 去掉 /login 或 /index.html 尾巴
            // 2) 剥离可能被污染的后端 API 前缀（/api 或 /api/vN）— 避免当登录页
            //    意外落在 /api/... 时把 sid 跳到后端 API 路径 → 404 (#1006)
            // 3) 去掉尾斜杠；空串代表根
            const rawPath = window.location.pathname
                .replace(/\/login\/?$/, '')
                .replace(/\/index\.html$/, '') || '/'
            const basePath = rawPath
                .replace(/^\/api(?:\/v\d+)?(?=\/|$)/, '')
                .replace(/\/+$/, '')
            // 保留原始 sid（如果有），不随机生成新的
            const existingSid = getQueryParam("sid") || ""
            const sidParam = existingSid ? `?sid=${existingSid}` : ""

            const goMain = () => {
                if ((window as any).__POWERED_EXTENSION__) {
                    window.location.reload()
                    return
                }
                window.location.href = `${window.location.origin}${basePath}/${sidParam}`
            }

            // 检查是否有待处理的邀请码（验证格式防止 XSS/Open Redirect）
            const pendingInvite = localStorage.getItem("pendingInviteCode");
            if (pendingInvite && /^[a-zA-Z0-9_-]+$/.test(pendingInvite)) {
                // dmwork-web#1068 Round 2：
                // 登录+邀请路径也要弹 join-success toast（与 InviteLanding 直连加入走同一 helper）。
                // 在调用 /space/join 前先快照 prevCurrentSpaceId，并预取 invite 信息拿 space_name。
                const prevCurrentSpaceId = localStorage.getItem("currentSpaceId") || "";
                // 预取邀请信息以便 toast 显示「位于 xxx 空间」。失败时降级为空 spaceName
                // （toast 也能显示常规「已加入」），不阻塞 auto-join 流程。
                const fetchInviteInfo = WKApp.apiClient
                    .get(`/space/invite/${pendingInvite}`)
                    .catch(() => null as any);
                fetchInviteInfo.then((inviteInfo: any) => {
                    WKApp.apiClient.post(`/space/join`, { invite_code: pendingInvite })
                        .then((result: any) => {
                            // 成功路径才删 pendingInviteCode
                            localStorage.removeItem("pendingInviteCode");
                            const status = result?.status;
                            if (status === "NEED_APPROVAL" || status === "PENDING") {
                                // 审批状态：统一走全局钩子，Layout state 渲染审批结果页
                                WKApp.endpoints.onJoinApproval(
                                    toJoinApprovalStatus(status),
                                    pendingInvite
                                );
                                return;
                            }
                            const spaceId = result?.space_id || inviteInfo?.space_id || "";
                            const spaceName = inviteInfo?.space_name || "";
                            // 与 InviteLanding 复用同一个 helper 计算 crossSpace + 存 notice。
                            const notice = computeAndSaveJoinSuccess(
                                { spaceId, spaceName, entityName: spaceName },
                                prevCurrentSpaceId,
                            );
                            // 与 InviteLanding 一致：跨 Space 时不自动切换 currentSpaceId —
                            // 等用户点 toast 里的「切换过去」按钮。
                            if (!notice.crossSpace && spaceId) {
                                localStorage.setItem('currentSpaceId', spaceId);
                            }
                            goMain();
                        })
                        .catch((e: any) => {
                            const msg = e?.msg || '';
                            if (msg.includes(t("app.invite.serverTerms.full", { locale: "zh-CN" })) || msg.includes('SPACE_FULL')) {
                                // SPACE_FULL 保留 pendingInviteCode，让用户下次重试
                                import('@douyinfe/semi-ui').then(({ Toast }) => Toast.error(t("app.invite.spaceFullCannotJoin")));
                            } else if (msg.includes(t("app.joinSpace.serverTerms.alreadyMember", { locale: "zh-CN" })) || msg.includes('already')) {
                                localStorage.removeItem("pendingInviteCode");
                                if (e?.space_id) localStorage.setItem('currentSpaceId', e.space_id);
                            } else {
                                localStorage.removeItem("pendingInviteCode");
                                console.warn('Auto-join space failed:', msg);
                            }
                            goMain();
                        });
                });
                return;
            }
            goMain()
        }
        WKApp.endpoints.addOnLogin(this.onLogin)

        this.tauriCheckUpdate()

    }

    componentWillUnmount() {
        WKApp.endpoints.removeOnLogin(this.onLogin);
        WKApp.endpoints.removeOnNeedJoinSpace(this.onNeedJoinSpace);
        WKApp.endpoints.removeOnJoinApproval(this.onJoinApproval);
    }

    /**
     * T5 — 冷启动 Space 检测
     * 用户直接打开 App（已有 token，不走 loginSuccess）时，检查是否有 Space。
     * - 有 Space → 不干预，正常走 SpaceGate / MainPage 原有逻辑
     * - 无 Space → 触发 onNeedJoinSpace() 显示 JoinSpacePage
     * 只执行一次，避免多次 render 重复触发。
     */
    private async checkSpaceOnColdStart() {
        if (this._spaceChecked) return;
        this._spaceChecked = true;

        try {
            const result = await WKApp.apiClient.get('space/my');
            const spaces = Array.isArray(result) ? result : (result?.data ?? []);
            if (spaces.length === 0) {
                WKApp.endpoints.onNeedJoinSpace();
            }
            // 有 Space：不干预，原有 SpaceGate 逻辑会继续处理
        } catch (e) {
            // 网络失败：静默降级，让原有流程继续
            console.warn('T5 space/my check failed, skipping:', e);
        }
    }

    async tauriCheckUpdate() {
        if(!(window as any).__TAURI_IPC__) {
            return
        }

        listen('tauri://update-status', function (res) {
        })

        try {
            const { shouldUpdate, manifest } = await checkUpdate()
            if (shouldUpdate) {
                // display dialog
                if(await os.platform() === "darwin") { // mac 自动下载更新
                    await installUpdate()
                }
                this.showUpdateUI(manifest)

            }
        } catch (error) {
            console.error('Update check failed:', error);
        }
    }

    showUpdateUI(manifest: UpdateManifest) {
      const notifyID =  NotificationUI.info({
            title: t("app.layout.update.newVersion", { values: { version: manifest.version } }),
            duration: 0,
            content: (
                <>
                    <div>{manifest.body}</div>
                    <div style={{ marginTop: 8 }}>
                        <Button onClick={ async () => {
                           // install complete, restart app
                           if(await os.platform() !== "darwin") {
                                await installUpdate()
                            }
                          await relaunch()
                        }}>{t("base.common.update")}</Button>
                        <Button onClick={()=>{
                            NotificationUI.close(notifyID)
                        }} type="secondary" style={{ marginLeft: 20 }}>
                            {t("app.layout.update.later")}
                        </Button>
                    </div>
                </>
            ),
        })
    }

    showProgressUI() {

    }

    render() {
        const { joinApproval } = this.state;

        // 审批结果页：任何入口 join 返回 NEED_APPROVAL/PENDING 时，统一由 Layout state 渲染
        if (joinApproval) {
            return (
                <JoinApprovalResult
                    status={joinApproval.status}
                    onDismiss={() => this.setState({ joinApproval: undefined })}
                />
            );
        }

        // Wave 2: 无 Space 引导页（覆盖主界面）
        if (this.state.showJoinSpace) {
            return (
                <JoinSpacePage
                    onSuccess={() => {
                        this.setState({ showJoinSpace: false });
                        try {
                            WKApp.endpoints.callOnLogin();
                        } catch (e) {
                            console.warn("callOnLogin error suppressed:", e);
                        }
                    }}
                />
            );
        }

        // OIDC bind page must take precedence over the invite-landing branch
        // below: if a future URL composition (deep link, stale cookie) ever puts
        // ?invite= on a /oidc/bind URL, we must still render the bind page —
        // otherwise the bind token gets silently dropped on the floor. Defense
        // in depth even though no documented flow constructs such a URL today.
        // PR #72 review yujiawei #2.
        if (window.location.pathname === '/oidc/bind') {
            const bindComponent = WKApp.route.get('/oidc/bind')
            if (bindComponent) {
                return bindComponent
            }
        }

        // 邀请链接检测
        const urlParams = new URLSearchParams(window.location.search);
        const inviteCode = urlParams.get("invite");
        const action = urlParams.get("action");
        if (inviteCode && action !== "login") {
            // 确保登录信息已加载（邀请页在 Provider 之前渲染）
            if (!WKApp.loginInfo.token) {
                WKApp.loginInfo.load();
            }
            // 如果 URL 没有 ?sid= 或 sid 不匹配，尝试从 localStorage 找正确的 token
            if (!WKApp.loginInfo.token) {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith("token") && key !== "token") {
                        const val = localStorage.getItem(key);
                        if (val) {
                            // 直接设置 token 和相关信息，不重定向
                            const sid = key.substring(5);
                            WKApp.loginInfo.token = val;
                            WKApp.loginInfo.uid = localStorage.getItem("uid" + sid) || "";
                            WKApp.loginInfo.name = localStorage.getItem("name" + sid) || "";
                            break;
                        }
                    }
                }
            }
            return <InviteLanding inviteCode={inviteCode} />;
        }

        return <Provider create={() => {
            return WKApp.shared
        }} render={(vm: WKApp): any => {
            if (!WKApp.shared.isLogined() || window.location.pathname.endsWith('/login')) {
                const loginComponent = WKApp.route.get("/login")
                if (!loginComponent) {
                    return <div>{t("app.layout.noLoginModule")}</div>
                }
                return loginComponent
            }
            // Space 模式：检查用户是否属于至少一个 Space
            if (!WKApp.shared.currentSpaceId) {
                // 尝试从 localStorage 恢复
                const cached = localStorage.getItem("currentSpaceId");
                if (cached) {
                    WKApp.shared.currentSpaceId = cached;
                    WKApp.shared.spaceChecked = true;
                }
            }
            if (!WKApp.shared.currentSpaceId && !WKApp.shared.spaceChecked) {
                return <SpaceGate />
            }
            return <ErrorBoundary moduleName={t("app.layout.errorBoundaryModuleName")}>
                <WKBase onContext={(ctx) => {
                    WKApp.shared.baseContext = ctx
                }}>
                    <MainPage />
                </WKBase>
            </ErrorBoundary>
        }} />

    }
}
