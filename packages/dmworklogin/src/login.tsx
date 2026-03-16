import React, { Component } from "react";
import { Button, Spin, Toast } from '@douyinfe/semi-ui';
import './login.css'
import QRCode from 'qrcode.react';
import { WKApp, Provider } from "@octo/base"
import { LoginStatus, LoginType, LoginVM } from "./login_vm";
import classNames from "classnames";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";
import { validatePassword } from "./passwordStrength";


// Known safe error messages from the server that can be shown to users
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
    "用户名或密码错误": "用户名或密码错误",
    "验证码错误": "验证码错误",
    "验证码已过期": "验证码已过期",
    "该邮箱已注册": "该邮箱已注册",
    "该用户名已存在": "该用户名已存在",
    "账号已被禁用": "账号已被禁用",
    "发送过于频繁": "发送过于频繁，请稍后再试",
};

/**
 * Sanitize server error messages to prevent information leakage.
 * Only known safe messages are shown; unknown errors get a generic message.
 */
function sanitizeErrorMessage(msg: string): string {
    if (!msg || typeof msg !== "string") return "操作失败，请稍后重试";
    const known = KNOWN_ERROR_MESSAGES[msg];
    if (known) return known;
    // Check if message looks safe (short, no HTML, no stack trace)
    if (msg.length <= 50 && !/[<>{}]|Error:|at /.test(msg)) {
        return msg;
    }
    console.warn("Suppressed raw server error:", msg);
    return "操作失败，请稍后重试";
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

type LoginState = {
    loginStatus: string
    loginUUID: string
    getLoginUUIDLoading: boolean
    scanner?: string  // 扫描者的uid
    qrcode?: string
}

class Login extends Component<any, LoginState> {




    render() {

        return <Provider create={() => {
            return new LoginVM()
        }} render={(vm: LoginVM) => {
            const handleLogin = async () => {
                // 兼容移动端自动填充不触发 onChange
                const usernameEl = document.querySelector<HTMLInputElement>('input[name="username"]')
                const passwordEl = document.querySelector<HTMLInputElement>('input[name="password"]')
                if (usernameEl?.value && !vm.username) vm.username = usernameEl.value
                if (passwordEl?.value && !vm.password) vm.password = passwordEl.value

                if (!vm.username) {
                    Toast.error("邮箱或用户名不能为空！")
                    return
                }
                if (!vm.password) {
                    Toast.error("密码不能为空！")
                    return
                }
                const isEmail = isValidEmail(vm.username)
                if (isEmail) {
                    vm.requestEmailLogin(vm.username, vm.password).catch((err) => {
                        Toast.error(sanitizeErrorMessage(err.msg))
                    })
                } else {
                    vm.requestLoginWithUsernameAndPwd(vm.username, vm.password).catch((err) => {
                        Toast.error(sanitizeErrorMessage(err.msg))
                    })
                }
            }

            return <div className="wk-login">
                {/* Left brand panel */}
                <div className="wk-login-brand">
                    {/* Logo fixed top-left */}
                    <div className="wk-login-brand-logo-top">
                        <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="logo" style={{ width: 36, height: 36, borderRadius: 10 }} />
                        <span className="wk-login-brand-logo-name">{WKApp.config.appName || 'DMWork'}</span>
                    </div>
                    <div className="wk-login-brand-inner">
                        <div className="wk-login-brand-logo">
                        </div>
                        <div className="wk-login-brand-headline">
                            AI Agent 时代的<br />即时通讯平台
                        </div>
                        <div className="wk-login-brand-subline">
                            连接人与 AI，让协作更高效。<br />
                            支持 Web、Mac、Windows、Linux 全平台。
                        </div>
                        <div className="wk-login-brand-features">
                            <div className="wk-login-brand-feature">
                                <div className="wk-login-brand-feature-icon">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" /></svg>
                                </div>
                                <div className="wk-login-brand-feature-text">内置 AI Bot，智能回复与自动化</div>
                            </div>
                            <div className="wk-login-brand-feature">
                                <div className="wk-login-brand-feature-icon">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                </div>
                                <div className="wk-login-brand-feature-text">端到端加密，数据安全可控</div>
                            </div>
                            <div className="wk-login-brand-feature">
                                <div className="wk-login-brand-feature-icon">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                                </div>
                                <div className="wk-login-brand-feature-text">实时消息，毫秒级响应</div>
                            </div>
                        </div>

                    </div>{/* end brand-inner */}

                    {/* Chat bubble decoration - absolute bottom */}
                    <div className="wk-login-brand-chat">
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--left">
                            <div className="wk-login-brand-chat-avatar">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
                            </div>
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-name">DMWork Bot</div>
                                <div className="wk-login-brand-chat-text">你好！我可以帮你整理今天的会议纪要 📝</div>
                            </div>
                        </div>
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--right">
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-text">好的，会议录音已发给你</div>
                            </div>
                        </div>
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--left">
                            <div className="wk-login-brand-chat-avatar">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
                            </div>
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-name">DMWork Bot</div>
                                <div className="wk-login-brand-chat-text">收到，正在生成摘要，稍等片刻 ⚡</div>
                            </div>
                        </div>
                    </div>
                </div>{/* end wk-login-brand */}

                {/* Right form panel */}
                <div className="wk-login-panel">
                    <div className="wk-login-content">
                        {/* Mobile logo fallback */}
                        <div className="wk-login-content-logo">
                            <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="logo" />
                        </div>

                        {vm.inviteInfo && (
                            <div className="wk-login-invite-banner">
                                <div>你被邀请加入 <strong>{vm.inviteInfo.space_name}</strong></div>
                                <div>{vm.inviteInfo.max_users > 0 ? `${vm.inviteInfo.member_count}/${vm.inviteInfo.max_users} 人` : `${vm.inviteInfo.member_count} 位成员`}</div>
                            </div>
                        )}
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.phone ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">欢迎回来</div>
                            <div className="wk-login-content-slogan-sub">登录你的账号以继续</div>
                            <div className="wk-login-content-form">
                                <input type="text" name="username" autoComplete="username" placeholder="邮箱 / 用户名" onChange={(v) => {
                                    vm.username = v.target.value
                                }} onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}></input>
                                <input type="password" name="password" autoComplete="current-password" placeholder="密码" onChange={(v) => {
                                    vm.password = v.target.value
                                }} onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}></input>
                                <div className="wk-login-content-form-buttons">
                                    <Button loading={vm.loginLoading} className="wk-login-content-form-ok" type='primary' theme='solid'
                                        onMouseDown={(e: React.MouseEvent) => { e.preventDefault() }}
                                        onClick={handleLogin}>登录</Button>
                                </div>
                                <div className="wk-login-content-form-others">
                                    <div className="wk-login-content-form-scanlogin" onClick={() => {
                                        vm.loginType = LoginType.qrcode
                                    }}>
                                        扫码登录
                                    </div>
                                    {vm.inviteInfo && (
                                        <div className="wk-login-content-form-switch" onClick={() => {
                                            vm.loginType = LoginType.register
                                        }}>
                                            没有账号？注册
                                        </div>
                                    )}
                                    <div className="wk-login-content-form-switch" onClick={() => {
                                        vm.loginType = LoginType.forgetPassword
                                    }}>
                                        忘记密码
                                    </div>
                                </div>
                                <div className="wk-login-content-download">
                                    <a href="/download/dmwork.apk" className="wk-login-download-btn">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                            <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48C14.15 1.23 13.1 1 12 1c-1.1 0-2.15.23-3.12.63L7.4.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31C6.97 3.26 6 5.01 6 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z" />
                                        </svg>
                                        <span>下载 Android 客户端</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.register ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">创建账号</div>
                            <div className="wk-login-content-slogan-sub">加入 {WKApp.config.appName || 'DMWork'}，开始高效协作</div>
                            <div className="wk-login-content-form">
                                <input type="email" name="reg-email" autoComplete="email" placeholder="邮箱" onChange={(v) => {
                                    vm.registerEmail = v.target.value
                                }}></input>
                                <input type="text" name="reg-name" autoComplete="name" placeholder="昵称" onChange={(v) => {
                                    vm.registerEmailName = v.target.value
                                }}></input>
                                <input type="password" name="reg-password" autoComplete="off" placeholder="密码" onChange={(v) => {
                                    vm.registerEmailPassword = v.target.value
                                    vm.notifyListener()
                                }}></input>
                                <PasswordStrengthIndicator password={vm.registerEmailPassword || ''} />
                                <input type="password" name="reg-confirm-password" autoComplete="off" placeholder="确认密码" onChange={(v) => {
                                    vm.registerEmailConfirmPassword = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-buttons">
                                    <Button loading={vm.registerLoading} className="wk-login-content-form-ok" type='primary' theme='solid' onClick={async () => {
                                        // 兼容移动端自动填充不触发 onChange
                                        const regEmailEl = document.querySelector<HTMLInputElement>('input[name="reg-email"]')
                                        const regNameEl = document.querySelector<HTMLInputElement>('input[name="reg-name"]')
                                        const regPwdEl = document.querySelector<HTMLInputElement>('input[name="reg-password"]')
                                        const regConfirmEl = document.querySelector<HTMLInputElement>('input[name="reg-confirm-password"]')
                                        if (regEmailEl?.value && !vm.registerEmail) vm.registerEmail = regEmailEl.value
                                        if (regNameEl?.value && !vm.registerEmailName) vm.registerEmailName = regNameEl.value
                                        if (regPwdEl?.value && !vm.registerEmailPassword) vm.registerEmailPassword = regPwdEl.value
                                        if (regConfirmEl?.value && !vm.registerEmailConfirmPassword) vm.registerEmailConfirmPassword = regConfirmEl.value

                                        if (!vm.registerEmail || !isValidEmail(vm.registerEmail)) {
                                            Toast.error("请输入正确的邮箱地址！")
                                            return
                                        }
                                        if (!vm.registerEmailName) {
                                            Toast.error("昵称不能为空！")
                                            return
                                        }
                                        const passwordError = validatePassword(vm.registerEmailPassword || '');
                                        if (passwordError) {
                                            Toast.error(passwordError)
                                            return
                                        }
                                        if (vm.registerEmailPassword !== vm.registerEmailConfirmPassword) {
                                            Toast.error("两次密码输入不一致！")
                                            return
                                        }
                                        vm.requestEmailRegister(vm.registerEmail, vm.registerEmailPassword, vm.registerEmailName).catch((err) => {
                                            Toast.error(sanitizeErrorMessage(err.msg))
                                        })
                                    }}>注册</Button>
                                </div>
                                <div className="wk-login-content-form-others">
                                    <div className="wk-login-content-form-switch" onClick={() => {
                                        vm.loginType = LoginType.phone
                                    }}>
                                        已有账号？登录
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.forgetPassword ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">重置密码</div>
                            <div className="wk-login-content-slogan-sub">输入注册邮箱，我们将发送验证码</div>
                            <div className="wk-login-content-form">
                                <input type="email" name="forget-email" autoComplete="email" placeholder="注册邮箱" onChange={(v) => {
                                    vm.forgetEmail = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-code-row">
                                    <input type="text" name="forget-code" autoComplete="one-time-code" placeholder="验证码" onChange={(v) => {
                                        vm.forgetCode = v.target.value
                                    }}></input>
                                    <Button className="wk-login-content-form-code-btn" disabled={vm.emailCodeCountdown > 0 || vm.emailCodeSending} loading={vm.emailCodeSending} onClick={() => {
                                        if (!vm.forgetEmail || !isValidEmail(vm.forgetEmail)) {
                                            Toast.error("请输入正确的邮箱地址！")
                                            return
                                        }
                                        vm.requestEmailSendCode(vm.forgetEmail, 2).catch((err) => {
                                            Toast.error(sanitizeErrorMessage(err.msg))
                                        })
                                    }}>{vm.emailCodeCountdown > 0 ? `${vm.emailCodeCountdown}s` : '发送验证码'}</Button>
                                </div>
                                <input type="password" name="forget-new-pwd" autoComplete="off" placeholder="新密码" onChange={(v) => {
                                    vm.forgetNewPassword = v.target.value
                                    vm.notifyListener()
                                }}></input>
                                <PasswordStrengthIndicator password={vm.forgetNewPassword || ''} />
                                <input type="password" name="forget-confirm-pwd" autoComplete="off" placeholder="确认新密码" onChange={(v) => {
                                    vm.forgetConfirmPassword = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-buttons">
                                    <Button loading={vm.forgetLoading} className="wk-login-content-form-ok" type='primary' theme='solid' onClick={async () => {
                                        if (!vm.forgetEmail || !isValidEmail(vm.forgetEmail)) {
                                            Toast.error("请输入正确的邮箱地址！")
                                            return
                                        }
                                        if (!vm.forgetCode) {
                                            Toast.error("验证码不能为空！")
                                            return
                                        }
                                        const newPasswordError = validatePassword(vm.forgetNewPassword || '');
                                        if (newPasswordError) {
                                            Toast.error(newPasswordError)
                                            return
                                        }
                                        if (vm.forgetNewPassword !== vm.forgetConfirmPassword) {
                                            Toast.error("两次密码输入不一致！")
                                            return
                                        }
                                        vm.requestForgetPassword(vm.forgetEmail, vm.forgetCode, vm.forgetNewPassword).then(() => {
                                            Toast.success("密码重置成功，请登录")
                                            vm.loginType = LoginType.phone
                                        }).catch((err) => {
                                            Toast.error(sanitizeErrorMessage(err.msg))
                                        })
                                    }}>重置密码</Button>
                                </div>
                                <div className="wk-login-content-form-others">
                                    <div className="wk-login-content-form-switch" onClick={() => {
                                        vm.loginType = LoginType.phone
                                    }}>
                                        返回登录
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className={classNames("wk-login-content-scanlogin", vm.loginType === LoginType.qrcode ? "wk-login-content-scanlogin-show" : undefined)}>
                            <div className="wk-login-content-scanlogin-qrcode-title">扫码登录</div>
                            <div className="wk-login-content-scanlogin-qrcode-subtitle">更安全、更快速的登录方式</div>

                            {/* QR code card */}
                            <div className="wk-login-qr-card">
                                <Spin size="large" spinning={vm.qrcodeLoading}>
                                    <div className="wk-login-content-scanlogin-qrcode-wrap">
                                        <div className="wk-login-content-scanlogin-qrcode">
                                            {vm.qrcodeLoading || !vm.qrcode ? undefined : <QRCode value={vm.qrcode} size={176} fgColor={WKApp.config.themeColor}></QRCode>}
                                            <div className={classNames("wk-login-content-scanlogin-qrcode-avatar", vm.showAvatar() ? "wk-login-content-scanlogin-qrcode-avatar-show" : undefined)}>
                                                {vm.showAvatar() ? <img src={WKApp.shared.avatarUser(vm.uid!)}></img> : undefined}
                                            </div>
                                            {!vm.autoRefresh ? <div className="wk-login-content-scanlogin-qrcode-expire">
                                                <p>二维码已失效，点击刷新</p>
                                                <img onClick={() => { vm.reStartAdvance() }} src={require("./assets/refresh.png")}></img>
                                            </div> : undefined}
                                        </div>
                                    </div>
                                </Spin>
                                <div className="wk-login-qr-tip">打开 {WKApp.config.appName || 'DMWork'} 扫描二维码</div>
                            </div>

                            {/* Steps - horizontal */}
                            <div className="wk-login-qr-steps">
                                <div className="wk-login-qr-step-item">
                                    <div className="wk-login-qr-step-icon">
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="5" y="2" width="14" height="20" rx="2" />
                                            <circle cx="12" cy="17" r="1" fill="currentColor" />
                                        </svg>
                                    </div>
                                    <div className="wk-login-qr-step-title">打开 App</div>
                                    <div className="wk-login-qr-step-desc">手机打开 {WKApp.config.appName || 'DMWork'}</div>
                                </div>
                                <div className="wk-login-qr-step-divider">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c8cce0" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                                </div>
                                <div className="wk-login-qr-step-item">
                                    <div className="wk-login-qr-step-icon">
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
                                            <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                                            <circle cx="12" cy="12" r="2.5" />
                                        </svg>
                                    </div>
                                    <div className="wk-login-qr-step-title">扫描二维码</div>
                                    <div className="wk-login-qr-step-desc">聊天 → + → 扫一扫</div>
                                </div>
                                <div className="wk-login-qr-step-divider">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c8cce0" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
                                </div>
                                <div className="wk-login-qr-step-item">
                                    <div className="wk-login-qr-step-icon">
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                            <polyline points="22 4 12 14.01 9 11.01" />
                                        </svg>
                                    </div>
                                    <div className="wk-login-qr-step-title">确认登录</div>
                                    <div className="wk-login-qr-step-desc">手机端点击确认</div>
                                </div>
                            </div>

                            <div className="wk-login-footer-buttons">
                                <button onClick={() => { vm.loginType = LoginType.phone }}>使用账号密码登录</button>
                            </div>
                        </div>
                    </div>
                </div>{/* end wk-login-panel */}
            </div>
        }}>

        </Provider>
    }
}

export default Login