import { WKApp, ProviderListener } from "@tsdaodao/base";


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
    }

    set loginType(v: LoginType) {
        this._loginType = v
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
        const resp = await WKApp.apiClient.post(`user/login_authcode/${authCode}`);
        if (resp) {
            this.loginSuccess(resp)
        }
        this.loginLoading = false
    }

    async requestLoginWithUsernameAndPwd(username: string, password: string) {
        this.loginLoading = true
        this.notifyListener()
        return WKApp.apiClient.post(`user/login`, { "username": username, "password": password, "flag": 1 }).then((result)=>{
            this.loginSuccess(result)
        }).finally(()=>{
            this.loginLoading = false
            this.notifyListener()
        }) // flag 0.app 1.pc
    }

    loginSuccess(data:any) {
        const loginInfo = WKApp.loginInfo
        loginInfo.appID = data.app_id
        loginInfo.uid = data.uid
        loginInfo.shortNo = data.short_no
        loginInfo.token = data.token
        loginInfo.name = data.name
        loginInfo.sex = data.sex
        loginInfo.save()

        WKApp.endpoints.callOnLogin()
    }

    requestUUID() {
        if (this.qrcodeLoading) {
            return
        }
        this.qrcodeLoading = true
        this.notifyListener()
        WKApp.apiClient.get('user/loginuuid').then((result) => {
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
            this.pullLoginStatus(uuid)
        })
    }
    showAvatar() {
        return this.loginStatus === LoginStatus.scanned && this.uid
    }
}