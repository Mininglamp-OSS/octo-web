import React, { Component } from "react";
import { WKApp, WKBase, Provider, ErrorBoundary, t } from "@octo/base"
import { listen } from '@tauri-apps/api/event'
import { MainPage } from "../Pages/Main";
import SpaceGate from "../Components/SpaceGate";
import { Notification as NotificationUI, Button } from '@douyinfe/semi-ui';
import { checkUpdate, installUpdate, UpdateManifest } from '@tauri-apps/api/updater'
import { relaunch } from '@tauri-apps/api/process'
import { os } from "@tauri-apps/api";
import { getQueryParam, computeAndSaveJoinSuccess, removeSidFromPath, setSessionSid } from "@octo/base";
import type { JoinApprovalStatus } from "@octo/base";
import { toJoinApprovalStatus } from "@octo/base";
import InviteLanding from "../Components/InviteLanding";
import JoinSpacePage from "../Components/JoinSpacePage";
import JoinApprovalResult from "../Components/JoinApprovalResult";
import { StandaloneDocPage, parseStandaloneDocId, isStandaloneDocPath, persistStandaloneReturn, consumeStandaloneReturn } from "@octo/docs";
import { SummaryDetailPage } from "@dmwork/summary";
import { adoptStoredSession, findSidForToken, clearSessionsWithToken } from "./recoverSession";
import { isLoopCliAuthorizePath, LOOP_CLI_AUTHORIZE_PATH } from "@octo/loop";

interface AppLayoutState {
    showJoinSpace: boolean;
    joinApproval?: { status: JoinApprovalStatus; inviteCode: string };
}

/**
 * Recover an octo session for a clean deep-link that carries no `?sid=` in the URL.
 *
 * Both `/d/:docId` (standalone doc, #512) and `?invite=` links can be opened in a fresh tab where
 * the URL has no `sid`, so the sid-keyed `WKApp.loginInfo.load()` reads nothing even when the user
 * is signed in — their token lives under a `token{sid}` key in localStorage. Adopt the stored
 * session (token + uid + name) so the deep-link's authenticated requests succeed instead of
 * returning 401 for everyone. No-op when a token is already present or none is stored (a genuinely
 * anonymous visitor). The scan itself lives in recoverSession.ts (pure + unit-tested).
 *
 * `persist` distinguishes the two callers (XIN-392 P1-2 / XIN-519 blocker 2):
 *   - standalone (`persist: true`): recover a signed-in user's session on the sid-less cold load.
 *     One stored bucket → adopt and persist it back to the empty-sid slot so the page's Back → /docs
 *     full reload stays authenticated (XIN-390). Several buckets that all belong to the SAME identity
 *     (same uid — one person signed in across e.g. two spaces, the real-device multi-space case) →
 *     adopt the first IN MEMORY ONLY, so the link opens the doc instead of bouncing to login, without
 *     pinning a multi-bucket pick into the cross-tab slot. Buckets spanning DIFFERENT identities stay
 *     ambiguous → fall through to login (never guess a person). The doc's own space rides on `?sp`
 *     (preflight addressing), not on bucket selection.
 *   - invite (`persist: false`): adopts the first stored session IN MEMORY ONLY and never persists,
 *     which is the invite branch's original pre-#512 behavior (it must not start persisting just
 *     because both branches now share this helper).
 */
function recoverOctoSessionFromStorage(persist: boolean): void {
    if (WKApp.loginInfo.token) return;
    adoptStoredSession(WKApp.loginInfo, localStorage, { persist });
}

/**
 * The standalone `/d/:docId` page reached a 401 while a token WAS loaded — the current session is
 * expired (XIN-408). Clear that dead session and reload so the standalone branch below re-evaluates,
 * finds no token, and falls through to the real login screen. The deep-link target was already
 * stashed (persistStandaloneReturn) by the page, so the existing post-login bounce returns the user
 * to the document after sign-in — no new return-path plumbing.
 *
 * Why clearing by token VALUE, not just `logout()`: `logout()` clears only the CURRENT `?sid=`
 * bucket, but on a clean cold-load (no `?sid=`) the expired token was recovered from a `token{sid'}`
 * bucket and mirrored into the empty-sid bucket, so it lives in two places. Clearing every bucket
 * that holds this exact token (clearSessionsWithToken over both storages) tears down all copies, so
 * the reload's recovery can't re-adopt it and loop. A DIFFERENT valid session has a different token
 * and is left untouched (XIN-390/392: 只清当前过期 session，别误清有效 session).
 */
function clearExpiredStandaloneSessionAndReload(): void {
    const expiredToken = WKApp.loginInfo.token || "";
    // In-memory + current-sid bucket + cross-tab mirror (the sid-scoped part logout() handles).
    WKApp.loginInfo.logout();
    // Value-matched sweep for any remaining copies (the cold-load recover-then-persist case).
    if (expiredToken && typeof window !== "undefined") {
        clearSessionsWithToken(expiredToken, window.sessionStorage, window.localStorage);
    }
    if (typeof window !== "undefined") window.location.reload();
}

/** `/s/:taskNo` — summary taskNo is a single URL path segment, optional trailing slash. */
const STANDALONE_SUMMARY_PATH = /^\/s\/([A-Za-z0-9_-]+)\/?$/;

export function parseStandaloneSummaryTaskNo(pathname: string): string | null {
    if (typeof pathname !== "string") return null;
    const m = STANDALONE_SUMMARY_PATH.exec(pathname);
    return m ? m[1] : null;
}

// Only a well-formed single-segment `/s/<taskNo>` counts as standalone; `/s`,
// `/s/`, and nested `/s/a/b` must fall through (else the render branch mounts
// SummaryDetailPage with an undefined taskId).
export function isStandaloneSummaryPath(pathname: string): boolean {
    return parseStandaloneSummaryTaskNo(pathname) !== null;
}

function applyStandaloneSummarySpaceFromQuery(): void {
    const params = new URLSearchParams(window.location.search);
    const spaceId = params.get("sp") || params.get("space") || "";
    if (spaceId) WKApp.shared.currentSpaceId = spaceId;
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
            // #511 problem 2 (附带必修): a forwarded-doc link is `/docs?...&doc=<id>&sid=<space>`.
            // A first-time recipient logs in, then the post-login redirect used to keep only ?sid=
            // and drop ?doc=, landing them on the empty document list instead of the document they
            // clicked. Carry the doc deep-link (doc + space/folder) through the redirect so login
            // returns them to the target document.
            const forwardDoc = getQueryParam("doc") || ""
            const forwardSpace = getQueryParam("space") || ""
            const forwardFolder = getQueryParam("folder") || ""
            const forwardSp = getQueryParam("sp") || ""
            const redirectQuery = new URLSearchParams()
            if (forwardDoc) {
                redirectQuery.set("doc", forwardDoc)
                if (forwardSpace) redirectQuery.set("space", forwardSpace)
                if (forwardFolder) redirectQuery.set("folder", forwardFolder)
            }
            if (isStandaloneSummaryPath(window.location.pathname)) {
                // 与 applyStandaloneSummarySpaceFromQuery(sp||space) 对称：登录重定向也一并透传 space。
                if (forwardSp) redirectQuery.set("sp", forwardSp)
                if (forwardSpace) redirectQuery.set("space", forwardSpace)
            }
            const redirectQs = redirectQuery.toString()
            const redirectSearch = redirectQs ? `?${redirectQs}` : ""

            const goMain = () => {
                // A user who signed in from a shared /d/:docId link (local OR SSO/OIDC, where the
                // IdP returnTo lands back on /login) has a stashed standalone target — bounce them
                // back to that exact document instead of the app root. consumeStandaloneReturn
                // clears the key and only returns SAFE same-origin relative paths (open-redirect
                // guard), so a tampered value can never redirect off-origin.
                //
                // Carry the just-authenticated session's own sid on the reload (XIN-398), but keep
                // the URL clean: store the known bucket sid in SessionScope, then navigate to the
                // sid-less return path. The reloaded page still hits the right sid-keyed session
                // bucket, without exposing `?sid=` in the address bar.
                const standaloneReturn = consumeStandaloneReturn();
                if (standaloneReturn) {
                    const sessionSid = findSidForToken(localStorage, WKApp.loginInfo.token || "");
                    if (sessionSid) setSessionSid(sessionSid);
                    window.location.assign(removeSidFromPath(standaloneReturn))
                    return
                }
                if ((window as any).__POWERED_EXTENSION__) {
                    window.location.reload()
                    return
                }
                window.location.href = `${window.location.origin}${basePath}/${redirectSearch}`
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

        // The CLI authorization deep-link is a full-page flow outside the normal app shell.
        // Reuse a single stored Octo session when the clean URL carries no sid-specific token.
        if (isLoopCliAuthorizePath(window.location.pathname)) {
            if (!WKApp.loginInfo.token) {
                WKApp.loginInfo.load();
            }
            if (!WKApp.loginInfo.token) {
                recoverOctoSessionFromStorage(true);
            }
            if (WKApp.loginInfo.token) {
                if (!WKApp.shared.currentSpaceId) {
                    const cachedSpaceId = localStorage.getItem("currentSpaceId") || "";
                    if (cachedSpaceId) WKApp.shared.currentSpaceId = cachedSpaceId;
                }
                const cliAuthorizeComponent = WKApp.route.get(LOOP_CLI_AUTHORIZE_PATH);
                if (cliAuthorizeComponent) return cliAuthorizeComponent;
            }
        }

        // Standalone document deep-link (`/d/:docId`, octo-web #512): a shareable full-window
        // doc view that lives OUTSIDE the app shell (no MainPage / NavRail), mounted with the
        // same early-return interception the `?invite=` landing uses below. We claim the whole
        // `/d` namespace (not just well-formed ids) so a malformed/empty id renders the
        // standalone not-found terminal instead of silently falling through to the shell (AC-9).
        //
        // Auth: this branch renders before the Provider, so ensure the octo session is loaded
        // for the page's GET /docs/{docId} preflight + collab-token exchange. A clean cold-load
        // in a fresh tab carries no `?sid=`, so load() (sid-keyed) misses even a signed-in user's
        // token — recover it from localStorage the way the invite branch does (AC-3). When the
        // visitor is genuinely anonymous, fall through to the login screen rendered IN PLACE: the
        // pathname stays `/d/:docId`, so onLogin derives basePath from it and bounces the user
        // straight back to the doc (now with `?sid=`) after sign-in — the deep-link resumes
        // instead of dead-ending (AC-11). SPA deep-link serving depends on the nginx try_files
        // fallback (deployment concern, out of scope for this frontend change).
        if (isStandaloneDocPath(window.location.pathname)) {
            if (!WKApp.loginInfo.token) {
                WKApp.loginInfo.load();
            }
            if (!WKApp.loginInfo.token) {
                recoverOctoSessionFromStorage(true);
            }
            if (WKApp.loginInfo.token) {
                const standaloneDocId = parseStandaloneDocId(window.location.pathname);
                return <StandaloneDocPage docId={standaloneDocId} onSessionExpired={clearExpiredStandaloneSessionAndReload} />;
            }
            // Anonymous: stash the exact /d/:docId target so the post-login flow (local OR SSO/OIDC)
            // can bounce the user back to the document instead of the app root, then fall through to
            // the login screen (below) without navigating away. SessionScope keeps the session bucket
            // available without exposing sid in the return URL. The standalone page itself only
            // mounts once a token exists, so the anonymous path is the ONLY place this key gets
            // written for a first-time visitor — onLogin consumes it via consumeStandaloneReturn.
            persistStandaloneReturn();
            // Anonymous: fall through to the login screen (below) without navigating away.
        }

        // Standalone summary deep-link (`/s/:taskNo`): notification cards use task_no (not numeric
        // task_id), so pass the raw path segment into the detail fetch. Auth/session recovery mirrors
        // `/d/:docId`; anonymous visitors stash the exact target and return after login.
        if (isStandaloneSummaryPath(window.location.pathname)) {
            if (!WKApp.loginInfo.token) {
                WKApp.loginInfo.load();
            }
            if (!WKApp.loginInfo.token) {
                recoverOctoSessionFromStorage(true);
            }
            if (WKApp.loginInfo.token) {
                applyStandaloneSummarySpaceFromQuery();
                const standaloneTaskNo = parseStandaloneSummaryTaskNo(window.location.pathname);
                return <SummaryDetailPage taskId={standaloneTaskNo ?? undefined} />;
            }
            persistStandaloneReturn();
            // Anonymous: fall through to the login screen (below) without navigating away.
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
            // 如果 URL 没有 ?sid= 或 sid 不匹配，从 localStorage 恢复已登录会话
            // （与 /d/:docId 直达同一套 clean 冷加载恢复逻辑，但只在内存恢复、不持久化——
            //   invite 分支原本就不把恢复出来的 session 写回存储，共用 helper 后仍保持该语义，XIN-392 P1-2）
            if (!WKApp.loginInfo.token) {
                recoverOctoSessionFromStorage(false);
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
