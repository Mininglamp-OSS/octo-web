import React, { Component } from "react";
import { I18nContext, WKApp, apiFetchJson, computeAndSaveJoinSuccess, setSessionSid, t, toJoinApprovalStatus } from "@octo/base";
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
    /**
     * dmworkim#1319: 后端 4 个入群入口
     * (authorize / detail / scanjoin / handleJoinGroup) 在调用者
     * `GetUserDefaultSpaceID(uid) == ""` 时返回
     * `{status: "need_space", msg: "请先加入一个 Space 后再入群"}`。
     * 前端识别后不渲染加入按钮，改渲染「请先加入一个 Space」引导 + CTA。
     * 本组件也覆盖 Space 邀请路径的防御性处理，契约与 iOS / Android 对齐。
     */
    needSpace: boolean;
}

export default class InviteLanding extends Component<InviteLandingProps, InviteLandingState> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    state: InviteLandingState = {
        loading: true,
        joining: false,
        needSpace: false,
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
            const body = await apiFetchJson<any>(`${WKApp.apiClient.config.apiURL}space/invite/${this.props.inviteCode}`);
            // dmworkim#1319: detail 入口可能返回 need_space
            // 状态（后端契约：{status: "need_space", msg: "..."}）。识别到时
            // 持久化邀请码并切到 need_space 分支，避免渲染入群/入 Space 按钮。
            if (this.isNeedSpaceResponse(200, body)) {
                this.enterNeedSpace();
                return;
            }
            this.setState({ loading: false, info: body });
        } catch (e) {
            const body = this.getApiErrorData(e);
            const status = this.getApiErrorStatus(e);
            if (this.isNeedSpaceResponse(status, body)) {
                this.enterNeedSpace();
                return;
            }
            const message = e instanceof Error ? e.message : "";
            const hasBackendMessage = Boolean(
                e && typeof e === "object" && typeof (e as { backendMessage?: unknown }).backendMessage === "string"
            );
            this.setState({
                loading: false,
                error: hasBackendMessage && message
                    ? message
                    : status
                        ? t("app.invite.invalidCode")
                        : t("app.invite.networkError"),
            });
        }
    }

    /**
     * dmworkim#1319: 识别后端 need_space 契约。
     * 后端四个入群入口 (authorize / detail / scanjoin / handleJoinGroup) 在
     * 调用者无默认 Space 时返回 {status: "need_space", msg: "..."}。该契约
     * 同时被本组件用于防御性兼容 Space 邀请路径（当后端同步扩展时无需改前端）。
     *
     * 注意：不能用 `resp.ok` 前置过滤——后端既可能用 200 返回该结构，也可能
     * 用非 2xx（如 403）包装；因此只凭 body.status 判定。
     */
    private isNeedSpaceResponse(_status: number, body: any): boolean {
        return !!body && body.status === "need_space";
    }

    private getApiErrorData(error: unknown): any {
        return error && typeof error === "object" && "data" in error
            ? (error as { data?: unknown }).data
            : undefined;
    }

    private getApiErrorStatus(error: unknown): number {
        if (!error || typeof error !== "object") return 0;
        const status = (error as { httpStatus?: unknown; status?: unknown }).httpStatus
            ?? (error as { status?: unknown }).status;
        return typeof status === "number" ? status : 0;
    }

    /**
     * 切换到 need_space 渲染分支：
     * - 保留 inviteCode 到 localStorage（pendingInviteCode），Space 加完后
     *   Layout.onLogin 自动重试 space/join，形成「加 Space → 自动入群」闭环。
     * - 不再渲染「加入 Space / 加入群聊」按钮，避免误点。
     */
    private enterNeedSpace() {
        try {
            localStorage.setItem("pendingInviteCode", this.props.inviteCode);
        } catch (_e) {
            // localStorage 被禁用时降级，不阻塞渲染
        }
        this.safeSetState({ loading: false, joining: false, needSpace: true });
    }

    /**
     * Session expired / 未授权判断：
     * - 后端返回 401 / 403
     * - 或错误 msg 提示 token / 登录失效
     * dmwork-web#1047: 已登录但 token 过期的用户需要被明确引导重新登录，
     * 而不是卡在「加入」按钮点击失败的状态。
     */
    private isUnauthorizedError(status: number, msg: string): boolean {
        if (status === 401 || status === 403) return true;
        const m = (msg || "").toLowerCase();
        return (
            m.includes("unauthorized") ||
            m.includes("token") ||
            msg.includes(t("app.invite.serverTerms.login", { locale: "zh-CN" })) ||
            msg.includes(t("app.invite.serverTerms.unauthorized", { locale: "zh-CN" })) ||
            msg.includes(t("app.invite.serverTerms.credential", { locale: "zh-CN" }))
        );
    }

    private redirectToLoginWithPendingInvite(hint?: string) {
        // 保留邀请码，登录成功后 Layout.onLogin 会自动加入 Space
        localStorage.setItem("pendingInviteCode", this.props.inviteCode);
        if (hint) Toast.warning(hint);
        // 延迟一点让 Toast 能被用户看到
        setTimeout(() => this.handleGoLogin(), hint ? 600 : 0);
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

    /**
     * 计算用于跳转的前端应用 basePath（不含尾斜杠）。
     *
     * 防御性处理：如果当前 pathname 落在后端 API 路径（/api 或 /api/vN）下，
     * 直接用 `window.location.pathname` 作为 basePath 会把加入成功后的跳转
     * 拼成 `/api/?sid=xxx`，从而命中后端 404 —— 这正是 #1006 的症状
     * （邀请链接包含 /api/ 前缀时复现）。
     *
     * - pathname = "/"               → basePath = ""      → 跳 `/` ✓
     * - pathname = "/api/"            → basePath = ""      → 跳 `/` ✓（修复点）
     * - pathname = "/api/v1/..."     → basePath = ""      → 跳 `/` ✓（修复点）
     * - pathname = "/web/"            → basePath = "/web" → 跳 `/web/` ✓（子路径部署兼容）
     */
    private getAppBasePath(): string {
        const pathname = window.location.pathname || "/";
        // 剥离可能被污染的后端 API 前缀
        const stripped = pathname.replace(/^\/api(?:\/v\d+)?(?=\/|$)/, "");
        // 去掉尾斜杠；返回 '' 表示根
        return stripped.replace(/\/+$/, "");
    }

    async handleJoin() {
        if (this.joinInProgress) return;
        this.joinInProgress = true;
        this.safeSetState({ joining: true });
        try {
            const token = this.findToken();
            // 无 token（可能 localStorage 被清 / 跨浏览器访问）：直接走登录引导，避免 API 401
            if (!token) {
                this.redirectToLoginWithPendingInvite(t("app.invite.needLoginBeforeJoin"));
                return;
            }
            // dmwork-web#1065: 在调用 /space/join 前先记住用户「当前 Space」。
            // 多 Space 用户在非归属 Space 点邀请链接时，不应自动切换 currentSpaceId —
            // 必须由用户显式点 toast 里的「切换过去」才切。这里在改动前快照下来。
            const prevCurrentSpaceId = localStorage.getItem("currentSpaceId") || "";
            const apiUrl = WKApp.apiClient.config.apiURL?.replace(/\/+$/, '');
            const result = await apiFetchJson<any>(`${apiUrl}/space/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', token },
                body: JSON.stringify({ invite_code: this.props.inviteCode }),
            });
            // dmworkim#1319: authorize / scanjoin 亦可能
            // 同步返回 need_space。与 detail 分支走同一 enterNeedSpace()，
            // 保证 CTA + pendingInviteCode 自动重试语义一致。
            if (this.isNeedSpaceResponse(200, result)) {
                this.enterNeedSpace();
                return;
            }
            const status: JoinSpaceStatus | undefined = result?.status;

            if (status === "NEED_APPROVAL" || status === "PENDING") {
                // 审批状态：触发全局钩子，Layout 统一渲染审批结果页
                WKApp.endpoints.onJoinApproval(
                    toJoinApprovalStatus(status),
                    this.props.inviteCode
                );
                return;
            }

            const joinedSpaceId = result?.space_id || this.state.info?.space_id || "";
            const joinedSpaceName = this.state.info?.space_name || "";
            // 统一经 computeAndSaveJoinSuccess 计算 crossSpace 并
            // 写 sessionStorage notice。Layout.onLogin 的 pendingInviteCode 分支也走
            // 同一 helper，保证两条路径的 toast 行为一致。
            const notice = computeAndSaveJoinSuccess(
                {
                    spaceId: joinedSpaceId,
                    spaceName: joinedSpaceName,
                    entityName: joinedSpaceName,
                },
                prevCurrentSpaceId,
            );
            const crossSpace = notice.crossSpace;

            // 硬约束：不自动切换 currentSpace。只有非跨 Space（或无历史 Space）时才更新。
            if (!crossSpace && joinedSpaceId) {
                localStorage.setItem('currentSpaceId', joinedSpaceId);
            }
            // 跳转回主界面（sid-clean 派：先把 sid 存到 SessionScope
            // sessionStorage，跳转 URL 就不再挂 `?sid=` 了。RouteManager 的
            // ensureSessionSid() + stripSessionSidFromUrl() 会兜底读取和清理。
            // 之前 append `?sid=` 到地址栏是 sid-in-URL 派做法，跟 fork 主流
            // Layout/index.tsx 的 sid-clean 实现相反 —— 由 PR#851 定为
            // sid-clean 之后统一收敛到这一处。
            const sid = this.findSid();
            if (sid) setSessionSid(sid);
            // 使用安全的 basePath，避免当 pathname 为 /api/ 时跳到后端 API 路径（#1006）
            const basePath = this.getAppBasePath();
            window.location.href = `${window.location.origin}${basePath}/`;
        } catch (e: any) {
            const body = this.getApiErrorData(e);
            if (this.isNeedSpaceResponse(this.getApiErrorStatus(e), body)) {
                this.enterNeedSpace();
                return;
            }
            const msg = e?.message || "";
            const status = this.getApiErrorStatus(e);
            // session 过期 / 未授权 → 引导重新登录（携带 pendingInviteCode 登录后自动加群）
            if (this.isUnauthorizedError(status, msg)) {
                this.redirectToLoginWithPendingInvite(t("app.invite.sessionExpiredJoin"));
                return;
            }
            if (msg.includes(t("app.invite.serverTerms.full", { locale: "zh-CN" })) || msg.includes("SPACE_FULL")) {
                Toast.error(t("app.invite.spaceFullCannotJoin"));
            } else {
                Toast.error(msg || t("app.invite.joinFailed"));
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
        // 使用安全的 basePath，避免硬编码 /web 导致部署路径不匹配，
        // 同时剥离 /api 前缀防止登录页被错误托管在后端 API 路径下（#1006）
        const basePath = this.getAppBasePath();
        window.location.href = `${window.location.origin}${basePath}/?invite=${encodeURIComponent(this.props.inviteCode)}&action=login`;
    }

    /**
     * dmworkim#1319: 「去输入邀请码」CTA 点击。
     *
     * 触发 `WKApp.endpoints.onNeedJoinSpace()` 会让 Layout 弹出 JoinSpacePage
     * 全屏覆盖（见 `apps/web/src/Layout/index.tsx`）。JoinSpacePage 成功加入
     * Space 后 Layout.onSuccess 会调用 `WKApp.endpoints.callOnLogin()`，
     * 从而复用 `onLogin` 里既有的 `pendingInviteCode` 自动入 Space 分支
     * 形成「加 Space → 自动重试入群/入 Space」闭环。因此这里必须确保
     * pendingInviteCode 已写入（enterNeedSpace 已处理，此处再兜底写一次）。
     */
    handleGoJoinSpace() {
        try {
            localStorage.setItem("pendingInviteCode", this.props.inviteCode);
        } catch (_e) {
            // ignore persistence failure; onNeedJoinSpace 后用户仍可手工粘贴邀请码
        }
        try {
            WKApp.endpoints.onNeedJoinSpace();
        } catch (e) {
            console.warn("onNeedJoinSpace error suppressed:", e);
        }
    }

    render() {
        const { loading, info, error, joining, needSpace } = this.state;
        const { t } = this.context;
        const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe', '#43e97b', '#fa709a'];
        const isLoggedIn = WKApp.shared.isLogined();

        if (loading) {
            return <div className="invite-landing"><Spin size="large" /></div>;
        }

        // dmworkim#1319: need_space 分支
        //
        // 后端 4 个入群入口 (authorize / detail / scanjoin / handleJoinGroup)
        // 在调用者无默认 Space 时返回 {status: "need_space"}。此处是该契约在
        // Web SPA 内的识别点：不渲染「加入群聊 / 加入 Space」按钮（否则点击
        // 必然再次命中同一个 need_space 返回，UX 卡死），改渲染显式引导 +
        // 「去输入邀请码」CTA，点击后触发 onNeedJoinSpace 弹出 JoinSpacePage
        // 全屏覆盖。JoinSpacePage 成功加入 Space 后由 Layout.onSuccess 回调
        // 统一 callOnLogin → pendingInviteCode 分支自动重试入群/入 Space。
        //
        // 注意：优先于 error / !info 分支渲染——need_space 响应可能携带
        // 非 2xx 状态码，此时 info 为空，需要直接进 need_space 分支。
        if (needSpace) {
            return (
                <div className="invite-landing">
                    <div className="invite-landing-card" data-testid="invite-landing-need-space">
                        <div className="invite-landing-icon" style={{ backgroundColor: colors[0] }}>
                            🏠
                        </div>
                        <div className="invite-landing-name">{t("app.invite.needSpace.title")}</div>
                        <div className="invite-landing-hint">
                            {t("app.invite.needSpace.hint")}
                        </div>
                        <Button type="primary" size="large"
                            className="invite-landing-btn"
                            data-testid="invite-landing-need-space-cta"
                            onClick={() => this.handleGoJoinSpace()}>
                            {t("app.invite.needSpace.cta")}
                        </Button>
                    </div>
                </div>
            );
        }

        if (error || !info) {
            return (
                <div className="invite-landing">
                    <div className="invite-landing-card">
                        <div className="invite-landing-error">❌ {error || t("app.invite.invalidCode")}</div>
                        <Button onClick={() => {
                            const url = new URL(window.location.href);
                            url.searchParams.delete("invite");
                            window.location.href = url.toString();
                        }}>{t("app.common.back")}</Button>
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
                    <div className="invite-landing-subtitle">{t("app.invite.inviteYouJoin")}</div>
                    <div className="invite-landing-members">
                        {info.max_users > 0
                            ? t("app.invite.memberCountWithLimit", { values: { count: info.member_count, max: info.max_users } })
                            : t("app.invite.memberCount", { values: { count: info.member_count } })}
                    </div>

                    {isLoggedIn ? (
                        <Button type="primary" size="large" loading={joining}
                            className="invite-landing-btn"
                            disabled={info.max_users > 0 && info.member_count >= info.max_users}
                            onClick={() => this.handleJoin()}>
                            {info.max_users > 0 && info.member_count >= info.max_users
                                ? t("app.invite.spaceFull")
                                : t("app.invite.joinSpace")}
                        </Button>
                    ) : (
                        <>
                            {/* dmwork-web#1047: 未登录态必须展示明显的「登录后加入」CTA，
                                避免用户只看到空白或 App 下载按钮而无处下一步。 */}
                            <div className="invite-landing-hint">
                                {t("app.invite.loginHint")}
                            </div>
                            <Button type="primary" size="large"
                                className="invite-landing-btn"
                                data-testid="invite-landing-login-cta"
                                onClick={() => this.handleGoLogin()}>
                                {t("app.invite.loginAfterJoin")}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        );
    }
}
