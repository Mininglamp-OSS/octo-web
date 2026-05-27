import { WKApp, ProviderListener } from "@octo/base";
import { applyLoginResp } from "./loginSession";
import {
    buildAuthorizeURL,
    clearPendingOidcLogin,
    fetchAuthcode,
    fetchHttpClient,
    getPendingOidcLogin,
    getProviderById,
    isPendingExpired,
    OidcPollCancelledError,
    OidcPollNetworkError,
    OidcPollTimeoutError,
    OIDC_AUTH_STATUS,
    parseOidcUrlState,
    pollAuthStatus,
    savePendingOidcLogin,
} from "./oidc";
import { loginT as t } from "./i18n";


export class LoginStatus {
    static getUUID: string = "getUUID"
    static waitScan: string = "waitScan"
    static authed: string = "authed"
    static scanned: string = "scanned"
    static expired: string = "expired"
}

export enum LoginType {
    qrcode, // 二维码登录
    phone, // 手机号登录
    register, // 注册
    forgetPassword, // 忘记密码
}

export class LoginVM extends ProviderListener {
    loginStatus: string = LoginStatus.getUUID // 登录状态
    qrcodeLoading: boolean = false // 二维码加载中
    uuid?: string
    qrcode?: string
    expireMaxTryCount: number = 5 // 过期最多次数（超过指定次数则永远显示过期，需要用户手动刷新）
    private _expireTryCount: number = 0 // 过期尝试次数

    uid?: string // 当前扫描的用户uid
    private _loginType: LoginType = LoginType.phone

    private _pullMaxErrCount: number = 10 //  pull登录状态请求最大错误次数，超过指定次数将不再请求
    private _pullErrCount: number = 0 // 当前pull发生错误请求次数

    private _autoRefresh: boolean = true // 是否自动刷新二维码
     loginLoading: boolean = false // 登录中

    // ---------- 手机登录方式 ----------
    username?:string
    password?:string
    /** 本地账号登录失败标记，用于在表单中内联展示「使用 SSO 登录或注册」引导 */
    loginAttemptFailed: boolean = false

    // ---------- 注册方式 ----------
    registerUsername?:string
    registerName?:string
    registerPassword?:string
    registerConfirmPassword?:string
    registerLoading: boolean = false

    // ---------- 邮箱注册方式 ----------
    registerEmail?:string
    registerEmailPassword?:string
    registerEmailConfirmPassword?:string
    registerEmailName?:string
    registerEmailCode?:string           // 注册验证码
    registerCodeCountdown: number = 0
    private _registerCountdownTimer?: any
    emailCodeCountdown: number = 0
    private _countdownTimer?: any

    // ---------- 忘记密码 ----------
    forgetEmail?:string
    forgetCode?:string
    forgetNewPassword?:string
    forgetConfirmPassword?:string
    forgetLoading: boolean = false

    // ---------- 邀请信息 ----------
    inviteInfo?: { space_name: string; member_count: number; max_users: number; invite_code: string; space_id: string }
    inviteLoading: boolean = false

    set autoRefresh(v: boolean) {
        this._autoRefresh = v
        this.notifyListener()

        if (v) {
            this.reStartAdvance()
        }
    }

    get autoRefresh() {
        return this._autoRefresh
    }

    didMount(): void {
        this.advance()
        this.checkInviteParam()
    }

    private checkInviteParam() {
        const urlParams = new URLSearchParams(window.location.search)
        const inviteCode = urlParams.get('invite')
        if (!inviteCode || !/^[a-zA-Z0-9_-]+$/.test(inviteCode)) return

        // 保存到 localStorage，登录成功后 onLogin 回调会使用
        localStorage.setItem('pendingInviteCode', inviteCode)

        this.inviteLoading = true
        this.notifyListener()

        WKApp.apiClient.get(`space/invite/${inviteCode}`)
            .then((info: any) => {
                this.inviteInfo = info
                this.inviteLoading = false
                this.notifyListener()
            })
            .catch(() => {
                this.inviteLoading = false
                this.notifyListener()
            })
    }

    didUnMount(): void {
        if (this._countdownTimer) {
            clearInterval(this._countdownTimer)
            this._countdownTimer = undefined
        }
        if (this._registerCountdownTimer) {
            clearInterval(this._registerCountdownTimer)
            this._registerCountdownTimer = undefined
        }
        this._clearOidcLoadingResetTimer()
    }

    set loginType(v: LoginType) {
        this._loginType = v
        // 切换登录视图时清除上一次的失败提示，避免用户切到其他 tab 再切回时看到陈旧的橙色引导卡片
        this.loginAttemptFailed = false
        if (v === LoginType.qrcode) {
            this.reStartAdvance()
        }
        this.notifyListener()
    }
    get loginType(): LoginType {
        return this._loginType
    }

    reStartAdvance() {
        this.restCount()
        this.loginStatus = LoginStatus.getUUID
        this._autoRefresh = true
        this.notifyListener()
        this.advance()
    }


    advance(data?: any) {
        if (this.loginType !== LoginType.qrcode) {
            return
        }
        switch (this.loginStatus) {
            case LoginStatus.getUUID:
                this.requestUUID()
                break
            case LoginStatus.waitScan:
                this.pullLoginStatus(this.uuid)
                break
            case LoginStatus.scanned:
                this.uid = data.uid
                this.notifyListener()
                this.pullLoginStatus(this.uuid)
                break
            case LoginStatus.authed:
                this.restCount()
                this.requestLogin(data.auth_code)
                break
            case LoginStatus.expired:
                this._expireTryCount++
                if (this._expireTryCount > this.expireMaxTryCount) {
                    this.autoRefresh = false
                } else {
                    this.loginStatus = LoginStatus.getUUID
                    this.advance()
                }

        }
    }

    restCount() {
        this._expireTryCount = 0
        this._pullErrCount = 0
    }

    async requestLogin(authCode: string) {
        if (this.loginLoading) {
            return
        }
        this.loginLoading = true
        this.notifyListener()
        try {
            const resp = await WKApp.apiClient.post(`user/login_authcode/${authCode}`);
            if (resp) {
                this.loginSuccess(resp)
            }
        } catch (error) {
            console.error('Login failed:', error)
        } finally {
            this.loginLoading = false
            this.notifyListener()
        }
    }

    async requestLoginWithUsernameAndPwd(username: string, password: string) {
        this.loginLoading = true
        this.notifyListener()
        const device = this.getDevice()
        let deviceFlag = 1 // web
        // if(WKApp.shared.isPC) {
        //     deviceFlag = 2 // pc

        // }
        return WKApp.apiClient.post(`user/login`, { "username": username, "password": password, "flag": deviceFlag,"device":device }).then((result)=>{
            this.loginSuccess(result)
        }).finally(()=>{
            this.loginLoading = false
            this.notifyListener()
        }) // flag 0.app 1.pc
    }

    async requestRegister(username: string, name: string, password: string) {
        this.registerLoading = true
        this.notifyListener()
        const device = this.getDevice()
        return WKApp.apiClient.post(`user/usernameregister`, {
            "username": username,
            "name": name,
            "password": password,
            "flag": 1,
            "device": device,
        }).then((result) => {
            this.loginSuccess(result)
        }).finally(() => {
            this.registerLoading = false
            this.notifyListener()
        })
    }

    async requestRegisterSendCode(email: string) {
        return WKApp.apiClient.post('user/email/sendcode', {
            email: email,
            code_type: 0, // 0 = 注册
        }).then(() => {
            this.registerCodeCountdown = 60
            if (this._registerCountdownTimer) {
                clearInterval(this._registerCountdownTimer)
                this._registerCountdownTimer = undefined
            }
            this._registerCountdownTimer = setInterval(() => {
                this.registerCodeCountdown--
                if (this.registerCodeCountdown <= 0) {
                    clearInterval(this._registerCountdownTimer)
                    this._registerCountdownTimer = undefined
                }
                this.notifyListener()
            }, 1000)
        })
    }

    async requestEmailSendCode(email: string, codeType: number = 0) {
        return WKApp.apiClient.post('user/email/sendcode', {
            email: email,
            code_type: codeType,
        }).then(() => {
            this.emailCodeCountdown = 60
            // Clear any existing timer before creating a new one
            if (this._countdownTimer) {
                clearInterval(this._countdownTimer)
                this._countdownTimer = undefined
            }
            this._countdownTimer = setInterval(() => {
                this.emailCodeCountdown--
                if (this.emailCodeCountdown <= 0) {
                    clearInterval(this._countdownTimer)
                    this._countdownTimer = undefined
                }
                this.notifyListener()
            }, 1000)
        })
    }

    async requestEmailRegister(email: string, password: string, name: string, code: string) {
        this.registerLoading = true
        this.notifyListener()
        const device = this.getDevice()
        return WKApp.apiClient.post('user/emailregister', {
            email, password, name, code, flag: 1, device,
        }).then((result) => {
            // emailregister wraps response in {data: ...}
            this.loginSuccess(result)
        }).finally(() => {
            this.registerLoading = false
            this.notifyListener()
        })
    }

    async requestEmailLogin(email: string, password: string) {
        this.loginLoading = true
        this.notifyListener()
        const device = this.getDevice()
        return WKApp.apiClient.post('user/emaillogin', {
            email, password, flag: 1, device,
        }).then((result) => {
            // emaillogin wraps response in {data: ...}
            this.loginSuccess(result)
        }).finally(() => {
            this.loginLoading = false
            this.notifyListener()
        })
    }

    async requestForgetPassword(email: string, code: string, newPassword: string) {
        this.forgetLoading = true
        this.notifyListener()
        return WKApp.apiClient.post('user/email/forgetpwd', {
            email, code, new_password: newPassword,
        }).then((result) => {
            this.clearSensitiveFields()
            return result
        }).finally(() => {
            this.forgetLoading = false
            this.notifyListener()
        })
    }

    getDevice() {
        return {
            "device_id": WKApp.shared.deviceId,
            "device_name": WKApp.shared.deviceName,
            "device_model": WKApp.shared.deviceModel,
        }
    }

    clearSensitiveFields() {
        this.password = ''
        this.registerEmailPassword = ''
        this.registerEmailCode = ''
        this.forgetNewPassword = ''
    }

    loginSuccess(data:any, provider: string = 'local') {
        this.clearSensitiveFields()
        // 数据映射 (含实名 tri-state) 与 loginInfo.save() 统一抽到 loginSession.ts
        // 共享; bind 流程 (BindPage) 复用同一份写入路径, 走的是后端同一份 execLogin.
        applyLoginResp(data, provider)

        // 登录/注册成功后，检查是否有待处理的邀请码（来自邀请链接）
        // 有邀请码：直接 callOnLogin()，邀请码加入逻辑统一由 Layout/onLogin 处理，避免重复执行
        const pendingInvite = localStorage.getItem("pendingInviteCode");
        if (pendingInvite && /^[a-zA-Z0-9_-]+$/.test(pendingInvite)) {
            try {
                WKApp.endpoints.callOnLogin()
            } catch (e) {
                console.warn('callOnLogin error suppressed:', e)
            }
            return;
        }

        // 无邀请码：先检查用户是否已有 Space，决定走正常流程还是引导页
        this.checkSpaceAndLogin()
    }

    /**
     * 检查用户是否已有 Space，决定后续跳转：
     * - 有 Space → 正常调 callOnLogin()
     * - 无 Space（空数组）→ 调 onNeedJoinSpace() 引导用户加入 Space（Wave 2 提供路由）
     */
    private checkSpaceAndLogin() {
        WKApp.apiClient.get('space/my').then((result: any) => {
            const spaces = Array.isArray(result) ? result : (result?.data ?? []);
            if (spaces.length === 0) {
                // 无 Space，走引导流程
                try {
                    WKApp.endpoints.onNeedJoinSpace()
                } catch (e) {
                    console.warn('onNeedJoinSpace error suppressed:', e)
                }
            } else {
                // 有 Space，正常登录
                try {
                    WKApp.endpoints.callOnLogin()
                } catch (e) {
                    console.warn('callOnLogin error suppressed:', e)
                }
            }
        }).catch(() => {
            // 请求失败时降级走正常登录流程，避免卡死
            console.warn('space/my check failed, falling back to normal login')
            try {
                WKApp.endpoints.callOnLogin()
            } catch (e) {
                console.warn('callOnLogin error suppressed:', e)
            }
        });
    }

    requestUUID() {
        if (this.qrcodeLoading) {
            return
        }
        this.qrcodeLoading = true
        this.notifyListener()
        const device = this.getDevice()
        WKApp.apiClient.get('user/loginuuid',{
            param: device,
        }).then((result) => {
            this.uuid = result.uuid
            this.qrcodeLoading = false
            this.qrcode = result.qrcode
            this.loginStatus = LoginStatus.waitScan
            this.notifyListener()
            this.advance()
        }).catch(() => {
            this.qrcodeLoading = false
            this.notifyListener()
        })
    }

    // 轮训登录状态
    pullLoginStatus(uuid?: string) {
        if (this.loginType !== LoginType.qrcode) {
            return
        }
        if (!uuid) {
            return
        }
        if (uuid !== this.uuid) return;
        if (this._pullErrCount >= this._pullMaxErrCount) {
            this._pullErrCount = 0
            this.loginStatus = LoginStatus.getUUID
            this.advance()
            return
        }

        WKApp.apiClient.get(`user/loginstatus?uuid=${uuid}`).then((result: any) => {
            this._pullErrCount = 0
            const loginStatus = result.status;
            this.loginStatus = loginStatus
            this.advance(result)
        }).catch(() => {
            this._pullErrCount++
            if (this._pullErrCount < this._pullMaxErrCount) {
                setTimeout(() => {
                    this.pullLoginStatus(uuid)
                }, 2000)
            } else {
                this._pullErrCount = 0
                this.loginStatus = LoginStatus.getUUID
                this.advance()
                this.notifyListener()
            }
        })
    }
    showAvatar() {
        return this.loginStatus === LoginStatus.scanned && this.uid
    }

    // ---------- OIDC SSO ----------
    oidcLoading: boolean = false
    oidcResuming: boolean = false
    oidcResumingProviderName?: string
    private _oidcCancelled: boolean = false
    private _oidcAbort?: AbortController
    // Fallback timer that flips oidcLoading back off if a redirect was
    // intercepted (popup blocker / beforeunload handler / future SPA router).
    private _oidcLoadingResetTimer?: ReturnType<typeof setTimeout>
    // Default loading-reset window. Overridable via test seam.
    static OIDC_LOADING_RESET_MS = 5000

    async startOidcLogin(providerId: string): Promise<void> {
        const provider = getProviderById(providerId)
        if (!provider) {
            console.warn('Unknown OIDC provider:', providerId)
            return
        }
        if (this.oidcLoading) return
        this.oidcLoading = true
        this.notifyListener()
        try {
            const authcode = await fetchAuthcode(fetchHttpClient)
            savePendingOidcLogin({
                providerId,
                authcode,
                savedAt: Date.now(),
            })
            const returnTo = `${window.location.origin}/login`
            // Schedule a fallback reset before navigating so a blocked redirect
            // does not leave the SSO button stuck in a loading state forever.
            if (this._oidcLoadingResetTimer) clearTimeout(this._oidcLoadingResetTimer)
            this._oidcLoadingResetTimer = setTimeout(() => {
                this._oidcLoadingResetTimer = undefined
                if (this.oidcLoading) {
                    this.oidcLoading = false
                    this.notifyListener()
                }
            }, LoginVM.OIDC_LOADING_RESET_MS)
            window.location.href = buildAuthorizeURL(provider, authcode, returnTo)
        } catch (e) {
            this.oidcLoading = false
            this.notifyListener()
            throw e
        }
    }

    async resumeOidcLoginIfPending(search: string = window.location.search): Promise<{
        handled: boolean
        success?: boolean
        error?: string
    }> {
        // Guard against re-entry: a parent remount that re-fires OidcResumeEffect
        // while a previous poll is still in-flight would otherwise orphan the
        // earlier AbortController and run two concurrent polls on the same authcode.
        if (this.oidcResuming) return { handled: false }
        const urlState = parseOidcUrlState(search)
        const pending = getPendingOidcLogin()
        // Only trust ?oidc_error=1 when there's a matching pending session.
        // Otherwise an external link could clear another flow or fake-toast a user.
        if (urlState.error && pending) {
            const name = getProviderById(pending.providerId)?.name || 'SSO'
            clearPendingOidcLogin()
            return { handled: true, success: false, error: t('oidc.failedWithProvider', { values: { provider: name } }) }
        }
        if (!pending) return { handled: false }
        if (isPendingExpired(pending)) {
            clearPendingOidcLogin()
            return { handled: true, success: false, error: t('oidc.timeout') }
        }
        const providerName = getProviderById(pending.providerId)?.name || 'SSO'
        this.oidcResuming = true
        this.oidcResumingProviderName = providerName
        this._oidcCancelled = false
        this._oidcAbort = new AbortController()
        this.notifyListener()
        try {
            const result = await pollAuthStatus({
                client: fetchHttpClient,
                authcode: pending.authcode,
                intervalMs: 2000,
                maxAttempts: 150,
                sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
                isCancelled: () => this._oidcCancelled,
                signal: this._oidcAbort.signal,
            })
            if (result.status === OIDC_AUTH_STATUS.SUCCESS && result.result) {
                clearPendingOidcLogin()
                this._resetOidcResume()
                this.loginSuccess(result.result, pending.providerId)
                return { handled: true, success: true }
            }
            clearPendingOidcLogin()
            this._resetOidcResume()
            return { handled: true, success: false, error: result.msg || t('oidc.failedWithProvider', { values: { provider: providerName } }) }
        } catch (e) {
            clearPendingOidcLogin()
            this._resetOidcResume()
            if (e instanceof OidcPollTimeoutError) {
                return { handled: true, success: false, error: t('oidc.timeout') }
            }
            if (e instanceof OidcPollCancelledError) {
                return { handled: true, success: false, error: t('oidc.canceled') }
            }
            if (e instanceof OidcPollNetworkError) {
                return { handled: true, success: false, error: t('oidc.network') }
            }
            return { handled: true, success: false, error: t('oidc.failed') }
        }
    }

    cancelOidcLogin(): void {
        this._oidcCancelled = true
        // Clear pending up front so a refresh during the sleep window does not
        // resume the just-cancelled session.
        clearPendingOidcLogin()
        // Abort any in-flight fetch so cancel propagates without waiting for
        // the next sleep tick. (If the poll is currently inside `sleep`, cancel
        // is still felt one interval later — the sleep itself isn't abortable.)
        this._oidcAbort?.abort()
        this._clearOidcLoadingResetTimer()
    }

    private _resetOidcResume(): void {
        this.oidcResuming = false
        this.oidcResumingProviderName = undefined
        this._oidcAbort = undefined
        this._clearOidcLoadingResetTimer()
        this.notifyListener()
    }

    private _clearOidcLoadingResetTimer(): void {
        if (this._oidcLoadingResetTimer) {
            clearTimeout(this._oidcLoadingResetTimer)
            this._oidcLoadingResetTimer = undefined
        }
    }
}
