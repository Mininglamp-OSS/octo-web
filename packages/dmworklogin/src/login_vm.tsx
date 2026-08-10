import { WKApp, ProviderListener, extractErrorCode } from "@octo/base";
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
    // 服务端在 login.scan_enabled=false 时用 200 + {"status":"disabled"} 回应 loginstatus。
    // 没有这个分支时它会落进 advance() 的 switch 里无人处理：轮询就此停摆，而页面上的
    // 二维码继续挂着，用户对着一张永远不会完成的码等下去。
    static disabled: string = "disabled"
}

/**
 * 扫码总开关关闭时，loginuuid / login_authcode / grant_login 返回的业务错误码。
 *
 * 按错误码判断而不是 HTTP 状态码：服务端 httperr.ResponseErrorL 对兼容期的端点一律
 * 把 wire status 钉在 400，真实状态只在 envelope 的 error.http_status 里。
 */
const SCAN_LOGIN_DISABLED_CODE = 'err.server.user.scan_login_disabled'

/**
 * `scanned` 确认窗口的本地兜底时长，取自对接文档约定的 5 分钟（服务端同一个值叫
 * user.ScanLoginConfirmWindow）。
 *
 * **两边不是同步的，是各自独立的一份**：服务端在扫码那一刻把 qrcode:{uuid} 的 TTL 续成
 * 这个值，客户端则在**首次轮询看到 scanned** 时才起算，天然晚一个长轮询周期。正常路径
 * 上到点的是服务端 —— 轮询读到 expired 就重铸，根本走不到这里；这份本地截止只在
 * 「status 因任何原因不再推进」（网关吞长轮询、Redis 抖动）时兜底，避免页面永久停在
 * 「已扫码，等待手机确认」。
 *
 * 所以如果服务端把窗口调长，这里必须跟着改，否则客户端会开始掐掉服务端仍然认可的会话。
 * 没有任何机制会在两边漂移时报错。
 */
const SCAN_LOGIN_CONFIRM_WINDOW_MS = 5 * 60 * 1000

/**
 * 兑换时上报的设备标识（octo-lib config.DeviceFlag: 0=APP, 1=Web, 2=PC）。
 *
 * 与 requestLoginWithUsernameAndPwd 里的 flag 取值保持一致。服务端在 flag 缺省/为 0
 * 时也会回落到 Web，显式带上只是让链路里的设备语义不依赖那条回落分支。
 */
const WEB_DEVICE_FLAG = 1

function isScanLoginDisabledError(err: unknown): boolean {
    return extractErrorCode(err) === SCAN_LOGIN_DISABLED_CODE
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
    // 轮询密钥：与 uuid 同批由 user/loginuuid 下发，仅存在于本浏览器会话，绝不进二维码。
    // 服务端凭它判断「轮询方是不是当初申请这个二维码的人」，只有匹配才回 auth_code。
    // 缺失或不匹配时服务端仍回状态、但剥掉 auth_code —— 页面会停在授权页，刷新即恢复。
    pollSecret?: string
    qrcode?: string
    expireMaxTryCount: number = 5 // 过期最多次数（超过指定次数则永远显示过期，需要用户手动刷新）
    private _expireTryCount: number = 0 // 过期尝试次数
    // 主动放弃扫码会话的次数（兑换失败 / 密钥被剥掉 / 确认窗口超时），与自然过期分开计数。
    // 见 restartScanLogin。
    private _abandonTryCount: number = 0
    /**
     * 服务端已明确告知扫码登录不可用（loginstatus 回 disabled，或某个入口回
     * err.server.user.scan_login_disabled）。
     *
     * 与 WKApp.remoteConfig.scanLoginEnabled 是两条独立的信息源，都要看：appconfig 有
     * 缓存/重试窗口（多副本运行时改开关最多 60 秒收敛），而这一条是链路刚刚拒绝过的
     * 事实。login.tsx 据此隐藏入口，避免用户点进来再吃一次必然失败的请求。
     */
    scanLoginDisabled: boolean = false
    // 本地的 scanned 确认截止时间（epoch ms）。进入 scanned 时落一次，重铸二维码时清掉。
    private _scannedDeadline?: number

    uid?: string // 当前扫描的用户uid
    private _loginType: LoginType = LoginType.phone

    private _pullMaxErrCount: number = 10 //  pull登录状态请求最大错误次数，超过指定次数将不再请求
    private _pullErrCount: number = 0 // 当前pull发生错误请求次数

    private _autoRefresh: boolean = true // 是否自动刷新二维码
    // 二维码会话代号：每次丢弃当前二维码会话（重铸、卸载）时递增，用于让在途的
    // loginuuid 响应识别自己已被取代。见 requestUUID / resetQRCodeState。
    private _qrSession: number = 0
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
        // 二维码轮询是 promise 链 + setTimeout，didUnMount 不动它就会在组件销毁后继续跑、
        // 继续改 VM、继续把 pollSecret 带在请求上。清掉 uuid 即可让下一次 pullLoginStatus
        // 在发射前的守卫处自然终止（uuid !== this.uuid），不需要额外的取消机制。
        this.resetQRCodeState()
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
        // 用户手动要求重来（点「点击刷新」/ 切回扫码 tab）就给一份新的放弃预算。刻意不放进
        // restCount()：authed 分支在兑换前也会调它，那会让闸门永远清零、拦不住任何东西。
        this._abandonTryCount = 0
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
                // 服务端的 scanned 状态**不再下发 uid**（payload 只有 app_id / status），
                // 所以这里是可选读取：拿不到就不显示扫码者头像。不得据此判断扫码者身份
                // 或推进状态机 —— 唯一的推进依据是 status。
                this.uid = data?.uid
                if (this.scannedWindowExpired()) {
                    // 手机端迟迟不确认。服务端的 qrcode TTL 到点后轮询本来也会读到
                    // expired，本地截止只是兜底那条路没走到的情况（网关吞长轮询、
                    // status 因任何原因不再推进），避免页面永久停在「等待手机确认」。
                    //
                    // 必须留日志：这条路会把一次已经发生的扫码丢掉，用户侧只看到「刚扫完
                    // 二维码就自己刷新了」。其余三个 restartScanLogin 调用点都有 warn，缺
                    // 这一条会让本地截止时间相关的故障在现场完全无迹可查。
                    console.warn('[login] scan-login confirm window elapsed locally; restarting scan flow')
                    this.restartScanLogin()
                    break
                }
                this.notifyListener()
                this.pullLoginStatus(this.uuid)
                break
            case LoginStatus.disabled:
                // 全链路已关闭：停轮询、清会话、隐藏入口并交还其他登录方式。
                this.handleScanLoginDisabled()
                break
            case LoginStatus.authed:
                if (!data?.auth_code) {
                    // 服务端只把 auth_code 发给持有 poll_secret 的轮询方。走到这里说明
                    // 本次轮询没能证明自己是二维码的申请方（发布窗口内的旧 bundle、
                    // 密钥已过期、或 Redis 抖动），auth_code 被剥掉了。
                    //
                    // 不能拿 undefined 去调 login_authcode：那会打出
                    // POST user/login_authcode/undefined 拿个 400，而轮询此刻已经停了
                    // —— 页面就此静止，手机端却显示"已授权"，用户只能自己刷新。
                    // 退回重新申请二维码，让流程能自愈。
                    //
                    // 这条分支静默触发时唯一可诊断的地方就是这里：如果 poll_secret 在生产
                    // 被中途丢掉（代理剥参数、Redis 抖动），症状是二维码悄悄自我重建而手机
                    // 显示"已授权"，在日志和监控里和正常过期完全无法区分。
                    console.warn('[login] scan-login status=authed without auth_code; poll_secret was not accepted, re-minting QR')
                    this.restartScanLogin()
                    break
                }
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

    /**
     * 丢弃当前扫码会话并重新申请二维码。
     *
     * 这是所有「这一轮扫码不可能再走通」的统一出口：auth_code 被剥掉、兑换失败或结果
     * 不确定、手机端超过确认窗口没确认。三种情况的共同要求是**绝不重试同一个
     * auth_code**（服务端一次性消费，重试只会拿到 auth_code_not_found），而是把
     * uuid / poll_secret / auth_code 一起丢掉重来。
     */
    private restartScanLogin() {
        this.resetQRCodeState()
        // 自己的计数闸门，不与 expired 共用 _expireTryCount：二维码 TTL 只有 60 秒，用户
        // 在扫码页干等几分钟就能把那个预算烧光，于是第一次真正的失败会立刻撞上限、直接
        // 死在「点击刷新」上；反过来 authed 分支在兑换前会 restCount() 清零，共用又会让
        // 这个闸门永远拦不住东西。两类失败语义不同，各记一份。
        //
        // 需要闸门的理由：密钥被链路中途剥掉时（authed 但没有 auth_code）重铸不需要人参与，
        // 是机器速度的循环，在日志里与正常过期无法区分。计满后亮出既有的「二维码已过期，
        // 点击刷新」覆盖层，把不可见的循环变成用户能看见、能操作的状态。手动点刷新
        // （reStartAdvance）会重置预算。
        this._abandonTryCount++
        if (this._abandonTryCount > this.expireMaxTryCount) {
            this.loginStatus = LoginStatus.expired
            // setter 传 false 不会触发 reStartAdvance，只停掉自动重铸并通知渲染。
            this.autoRefresh = false
            return
        }
        this.loginStatus = LoginStatus.getUUID
        this.notifyListener()
        this.advance()
    }

    /**
     * 服务端已明确关闭扫码登录时的收尾。
     *
     * 立刻停轮询、清掉会话凭据、标记入口不可用，并把用户交还给其他登录方式。
     * 刻意不亮「点击刷新」覆盖层：刷新只会再吃一次 disabled。
     */
    private handleScanLoginDisabled() {
        this.scanLoginDisabled = true
        this.resetQRCodeState()
        // 直接写字段而不是走 autoRefresh setter：这里只要停掉自动重铸，不需要 setter
        // 在 true 分支附带的 reStartAdvance 语义。
        this._autoRefresh = false
        this.loginStatus = LoginStatus.disabled
        // loginType setter 只在切到 qrcode 时重启流程，切回 phone 是安全的，并且会
        // notifyListener 让登录页重渲染（此时扫码入口已随 scanLoginDisabled 隐藏）。
        this.loginType = LoginType.phone
    }

    /**
     * 判断 scanned 的本地确认窗口是否已过；首次进入 scanned 时落下截止时间。
     *
     * 只在轮询返回时求值，所以感知延迟最多一个长轮询周期（10s）—— 作为兜底足够，
     * 不值得为它专门挂一个定时器再去和 didUnMount / 重铸抢生命周期。
     */
    private scannedWindowExpired(): boolean {
        if (this._scannedDeadline === undefined) {
            this._scannedDeadline = Date.now() + SCAN_LOGIN_CONFIRM_WINDOW_MS
            return false
        }
        return Date.now() > this._scannedDeadline
    }

    async requestLogin(authCode: string) {
        if (this.loginLoading) {
            // loginLoading 是共享的「登录中」标志：密码登录、邮箱登录都会置位，而两个面板
            // 同时挂载、只靠 display 切换。此刻直接 return 就等于把一枚**已经被手机确认掉**
            // 的授权码丢进黑洞：authed 分支不再安排任何轮询，页面就永久停在二维码上，而
            // 手机显示「已授权」—— 正是这次改动要消灭的那个形态。丢掉这一轮重新扫。
            console.warn('[login] scan-login redeem skipped: another login is in flight; restarting scan flow')
            this.restartScanLogin()
            return
        }
        // 兑换必须同时出示 auth_code 与申请这张二维码时拿到的 poll_secret。缺少或不匹配
        // 时服务端一律折叠成 err.server.user.auth_code_not_found —— 与「授权码不存在」
        // 完全同形，无法从响应上区分。所以没有密钥时不要把这枚一次性授权码浪费在必然
        // 失败的请求上，直接重来。
        const pollSecret = this.pollSecret
        if (!pollSecret) {
            console.warn('[login] scan-login redeem without poll_secret; re-minting QR')
            this.restartScanLogin()
            return
        }
        this.loginLoading = true
        this.notifyListener()
        let resp: unknown
        try {
            resp = await WKApp.apiClient.post(`user/login_authcode/${encodeURIComponent(authCode)}`, undefined, {
                param: { poll_secret: pollSecret, flag: WEB_DEVICE_FLAG },
            })
        } catch (error) {
            this.loginLoading = false
            if (isScanLoginDisabledError(error)) {
                // 兑换窗口内运维关掉了总开关。重来也没有意义。
                this.handleScanLoginDisabled()
                return
            }
            // auth_code 只能成功兑换一次。失败（含 auth_code_not_found、poll_secret 不
            // 匹配、网络超时后结果未知）之后必须丢掉整套 uuid / poll_secret / auth_code
            // 重新扫码，既不能重试同一码，也不能静默停在二维码页 —— 那样手机端显示
            // 「已授权」而页面永远不动，用户只能自己刷新。
            console.warn('[login] scan-login redeem failed; restarting scan flow', extractErrorCode(error) ?? error)
            this.restartScanLogin()
            return
        }
        this.loginLoading = false
        if (!resp) {
            // 2xx 但空响应：兑换结果不确定，而授权码已经被消费。服务端可能已经签发了
            // token 并更新 IM 状态，但这条响应里拿不到，重试同一码只会 not_found。
            console.warn('[login] scan-login redeem returned an empty response; restarting scan flow')
            this.restartScanLogin()
            return
        }
        // loginSuccess 刻意在 try 之外：它内部会写 token/loginInfo，再碰 localStorage、
        // 起 space/my 预检。一旦它抛（响应字段不合契约、嵌入环境里 storage 被禁），放在
        // 同一个 try 里就会被当成「兑换失败」去重铸二维码 —— 那时 token 已经写进去了，
        // 用户落在一个半登录态上，而页面在铸新码。兑换本身已经成功，这里的失败不该
        // 回滚扫码流程，只记录。
        try {
            this.loginSuccess(resp)
        } catch (error) {
            console.error('[login] scan-login redeemed but post-login handling failed', error)
        }
        this.notifyListener()
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
        // pollSecret 是本文件自己标注为凭据的字段，登录完成后没有理由继续挂在 VM 上。
        // 服务端在兑换时已经吊销它，所以影响有限；但既然这个函数的职责就是清凭据，
        // 漏掉它只是不一致。
        this.pollSecret = undefined
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
        // 捕获当前二维码会话代号。resetQRCodeState() 会递增它，didUnMount 也会 ——
        // 于是任何在那之后才落地的 loginuuid 响应都能认出自己已经被取代。
        //
        // 没有这道闸时：组件卸载 → didUnMount 清掉 uuid/pollSecret → 在途请求随后返回
        // → then 无条件把 uuid/pollSecret/qrcode 全部装回去、置 waitScan 并 advance()，
        // 于是一个已经卸载的 VM 重新开始隐藏轮询、继续把密钥挂在 query 上，甚至可能在
        // 用户看不见的地方走完扫码登录。清状态本身挡不住它，必须让在途响应自己作废。
        const session = this._qrSession
        WKApp.apiClient.get('user/loginuuid',{
            param: device,
        }).then((result) => {
            if (session !== this._qrSession) return
            this.uuid = result.uuid
            // 与 uuid 同生共死：二维码轮换时密钥必须一起换，否则会拿旧密钥去轮询新 uuid。
            this.pollSecret = result.poll_secret
            // 新码 = 新的确认窗口。expired 自然重铸那条路（advance 的 expired 分支直接转
            // getUUID）不经过 resetQRCodeState，旧截止时间会活下来 —— 于是用户扫这张新码，
            // 第一个 scanned 就被判超时、扫码被白白丢掉。在装配新会话的地方清才覆盖全部路径。
            this._scannedDeadline = undefined
            this.qrcodeLoading = false
            this.qrcode = result.qrcode
            this.loginStatus = LoginStatus.waitScan
            this.notifyListener()
            this.advance()
        }).catch((error) => {
            if (session !== this._qrSession) return
            if (isScanLoginDisabledError(error)) {
                // 总开关关闭时 loginuuid 返 scan_login_disabled。把它当成普通铸码失败会
                // 亮出「二维码已过期，点击刷新」—— 用户点一次再吃一次 400，既误导原因
                // 又形成一个人力驱动的死循环。走 disabled 收尾，隐藏入口。
                this.qrcodeLoading = false
                this.handleScanLoginDisabled()
                return
            }
            // 铸码失败必须交出一个可恢复的出口。此前只清 spinner：loginStatus 停在
            // getUUID、没有任何后续调度，而 login.tsx 只要 qrcode 非空就照渲染 —— 用户
            // 盯着一张已经被消费掉、永远完不成的二维码，没有报错也没有刷新入口，只能手动
            // 刷页面。#715 给 loginuuid 加了 StrictIPRateLimitMiddleware，共享出口 IP 下
            // 重铸可能吃 429，这条路会比以前更常走到。
            //
            // 关掉 autoRefresh 即可复用既有的 qr.expired 覆盖层（"二维码已过期，点击刷新"）
            // 及其 reStartAdvance 处理器 —— 不需要新文案，i18n:check 保持绿色。
            this.resetQRCodeState()
            this.qrcodeLoading = false
            this.autoRefresh = false
        })
    }

    /**
     * 丢弃当前二维码会话的全部状态。
     *
     * uuid / qrcode / pollSecret 必须一起清：留着任意一个都会让 UI 渲染出一张与当前状态
     * 不符的二维码，或者让轮询拿旧密钥去问新 uuid。也顺带消除了「转到 getUUID 到
     * requestUUID 把 qrcodeLoading 置位」之间那一帧的过期二维码。
     */
    private resetQRCodeState() {
        // 递增会话代号，让任何在途的 loginuuid 响应在落地时认出自己已过期（见
        // requestUUID）。清字段只能处理已经到手的状态，处理不了还在路上的那一份。
        this._qrSession++
        this.uuid = undefined
        this.qrcode = undefined
        this.pollSecret = undefined
        // 截止时间属于「这一张二维码」的状态。留着会让新码继承旧码的剩余窗口，扫完
        // 立刻被判超时。（新码铸成时也会清一次，见 requestUUID —— 走 expired 自然重铸
        // 那条路不经过这里。）
        this._scannedDeadline = undefined
        this.uid = undefined
        // 递增 _qrSession 的同时必须交出 qrcodeLoading 的所有权。
        //
        // 在途的 loginuuid 请求落地时会在会话代号处提前 return —— 那条 return 在
        // `qrcodeLoading = false` 之前，所以它不会再清这个标志。而 requestUUID 开头有
        // `if (this.qrcodeLoading) return`：标志一旦留在 true，紧接着的重铸会被自己挡住，
        // 页面停在一个转不完的 spinner 上（qrcode 已被清空），连「二维码已过期，点击刷新」
        // 也发不出任何请求，只能整页刷新。
        this.qrcodeLoading = false
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

        // 密钥走 query 而不是自定义请求头：自定义头会让轮询变成非简单请求，而 octo-lib 的
        // CORSMiddleware 把 Access-Control-Allow-Headers 写死且不含它、对 OPTIONS 又立即
        // abort —— 跨源预检拒掉的是**真正的 GET**，Tauri/Electron 正式包（走绝对地址，见
        // apps/web/src/apiURL.ts）扫码登录会彻底不可用。换来的收益只是让明文不进 access
        // log，而能读日志的运维本来就有 Redis 权限，挡不住任何人。真要防日志泄露应该在日志
        // 层做参数脱敏。
        // uuid !== this.uuid 的请求已在上面挡掉，此处 pollSecret 必与 uuid 同批下发。
        const secretQuery = this.pollSecret
            ? `&poll_secret=${encodeURIComponent(this.pollSecret)}`
            : ''
        WKApp.apiClient.get(`user/loginstatus?uuid=${encodeURIComponent(uuid)}${secretQuery}`).then((result: any) => {
            // 请求发出后 uuid 可能已经换掉（手动刷新走 reStartAdvance、切登录方式走
            // loginType setter）。发射前的守卫拦不到在途响应，落地时不复核就会用旧 uuid 的
            // 数据驱动状态机 —— 接受一个已被取代的 authed，或者反过来把刚铸好的二维码
            // 顶掉。2s 重试那条路是安全的（会重入本函数命中发射前的守卫），只有这里缺。
            if (uuid !== this.uuid) return
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
    /**
     * 是否展示扫码者头像。
     *
     * 现服务端的 scanned 状态不再下发 uid（payload 只有 app_id / status），所以这里实际
     * 恒为 falsy，登录页的头像位永远不会点亮。刻意保留而不是删掉 UI：uid 是否下发属于
     * 服务端策略，这条判断本身仍然正确（有 uid 才展示），删掉反而会让将来恢复下发时
     * 需要重新拼一遍展示链路。不得据此推进状态机。
     */
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
