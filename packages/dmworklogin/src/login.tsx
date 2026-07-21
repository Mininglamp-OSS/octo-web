import React, { Component, useState, useEffect, useRef } from "react";
import { Button, Select, Spin, Toast } from '@douyinfe/semi-ui';
// 不引入特定渠道 icon (Mail / Phone 都不准确, Aegis 同时支持邮箱和手机号).
// 主按钮纯文字, 避免锁定到任意一种登录方式让用户产生 "我没邮箱不能登" 的误判.
import './login.css'
import { QRCodeSVG } from 'qrcode.react';
import { WKApp, Provider, useI18n } from "@octo/base"
import type { Locale } from "@octo/base"
import { LoginStatus, LoginType, LoginVM } from "./login_vm";
import classNames from "classnames";
import { PasswordStrengthIndicator } from "./PasswordStrengthIndicator";
import { validatePassword } from "./passwordStrength";
import { getSSOProviders } from "./oidc";
import type { SSOProvider } from "./oidc";
import { AndroidDownloadButton } from "./AndroidDownloadButton";
import { IOSDownloadButton } from "./IOSDownloadButton";
import { loginT as t, serverErrorKeyFromMessage } from "./i18n";
import { resolveAegisRegisterUrl } from "./loginMigrationNoticeUrl";
import loginLogo from "./assets/login-logo.png";

const ENTERPRISE_SSO_ENABLED =
    import.meta.env.VITE_ENABLE_ENTERPRISE_SSO === 'true'
// Register URL 从当前 provider 的 accountUrl 派生，避免把 test/prod 用户带到
// 错误的 IdP 环境。若后续接入新的 OIDC provider 或非 Aegis 登录方式，入口配置
// 应改为由 appconfig 下发。

function getNextLocale(locale: Locale): Locale {
    return locale === "zh-CN" ? "en-US" : "zh-CN";
}

function openAegisRegister(registerUrl: string | undefined) {
    if (!registerUrl) return
    if (typeof window === 'undefined') return
    const nextWindow = window.open(registerUrl, '_blank', 'noopener,noreferrer')
    if (nextWindow) nextWindow.opener = null
}

const LoginLanguageSwitcher: React.FC = () => {
    const { locale, setLocale, t } = useI18n()
    const languageContainerRef = useRef<HTMLDivElement>(null)
    const pointerLanguageSelectionRef = useRef(false)
    const nextLocale = getNextLocale(locale)
    const title = t(nextLocale === "en-US"
        ? "base.navRail.language.switchToEnglish"
        : "base.navRail.language.switchToChinese")
    const locales = [
        { value: "zh-CN", label: t("login.languageShortZh"), showTick: false },
        { value: "en-US", label: t("login.languageShortEn"), showTick: false },
    ]

    const handleSelect = (next: unknown) => {
        if (next !== "zh-CN" && next !== "en-US") return
        setLocale(next)
        if (!pointerLanguageSelectionRef.current) return
        pointerLanguageSelectionRef.current = false
        requestAnimationFrame(() => {
            const activeElement = document.activeElement
            if (
                activeElement instanceof HTMLElement &&
                languageContainerRef.current?.contains(activeElement)
            ) {
                activeElement.blur()
            }
        })
    }

    return (
        <div
            ref={languageContainerRef}
            className="wk-login-language"
            title={title}
            onPointerDownCapture={() => {
                pointerLanguageSelectionRef.current = true
            }}
            onKeyDownCapture={() => {
                pointerLanguageSelectionRef.current = false
            }}
        >
            <Select
                className="wk-login-language-select"
                size="small"
                showArrow
                value={locale}
                optionList={locales}
                dropdownMatchSelectWidth={false}
                position="bottomRight"
                inputProps={{ 'aria-label': title }}
                onChange={handleSelect}
            />
        </div>
    )
}

const OidcResumeEffect: React.FC<{ vm: LoginVM }> = ({ vm }) => {
    const ranRef = useRef(false)
    useEffect(() => {
        if (ranRef.current) return
        ranRef.current = true
        let unmounted = false
        ;(async () => {
            const result = await vm.resumeOidcLoginIfPending()
            if (unmounted || !result.handled) return
            try {
                const url = new URL(window.location.href)
                url.searchParams.delete('oidc_error')
                window.history.replaceState({}, '', url.toString())
            } catch {
                /* noop */
            }
            if (result.success === false && result.error) {
                Toast.error(result.error)
            }
        })()
        return () => {
            unmounted = true
            // 不在 cleanup 里调 vm.cancelOidcLogin(): React 18 StrictMode 在 dev
            // 下会 mount → cleanup → mount, 这里清掉 sessionStorage 的 pending +
            // abort 会让第二次 mount 拿不到 pending, 整个 SSO 落地直接哑火.
            //
            // 真正需要取消的两条路径都被保留:
            //   1) 用户点 OidcResumingOverlay 的"取消"按钮 → 直接调 cancelOidcLogin
            //   2) 用户离开 /login (真正的 unmount, 比如关页面/导航走) → 浏览器
            //      会自动中断 in-flight fetch, JS 上下文销毁, poll 自然停
            // 5min TTL 是兜底, 不会无限循环.
        }
    }, [vm])
    return null
}

const OidcResumingOverlay: React.FC<{ vm: LoginVM }> = ({ vm }) => {
    if (!vm.oidcResuming) return null
    const providerName = vm.oidcResumingProviderName || 'SSO'
    return (
        <div className="wk-login-content-oidc-overlay">
            <Spin />
            <div className="wk-login-content-oidc-overlay-text">
                {t('oidc.resuming', { values: { provider: providerName } })}
            </div>
            <Button
                onClick={() => vm.cancelOidcLogin()}
                className="wk-login-content-oidc-overlay-cancel"
            >
                {t('common.cancel')}
            </Button>
        </div>
    )
}

const SsoLoginPanel: React.FC<{
    vm: LoginVM
    ssoProvider: SSOProvider
    startSsoLogin: () => void
    handleLogin: () => void
}> = ({ vm, ssoProvider, startSsoLogin, handleLogin }) => {
    const aegisRegisterUrl = resolveAegisRegisterUrl(ssoProvider.accountUrl)

    return (
        <div className="wk-login-content-form">
            <Button
                className="wk-login-content-sso-primary"
                loading={vm.oidcLoading}
                disabled={vm.oidcLoading || vm.oidcResuming}
                onClick={startSsoLogin}
            >
                <span className="wk-login-content-sso-primary-inner">
                    <svg className="wk-login-content-sso-primary-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 2 4 5v6c0 5 3.5 9.4 8 11 4.5-1.6 8-6 8-11V5l-8-3z" />
                        <path d="m9 12 2 2 4-4" />
                    </svg>
                    <span>{t('login.ssoButton')}</span>
                </span>
            </Button>
            {aegisRegisterUrl && (
                <div className="wk-login-content-sso-register-entry">
                    <Button
                        theme="borderless"
                        size="small"
                        disabled={vm.oidcLoading || vm.oidcResuming}
                        onClick={() => openAegisRegister(aegisRegisterUrl)}
                    >
                        {t('login.noAccountRegister')}
                    </Button>
                </div>
            )}
            <div className="wk-login-content-sso-flow-hint">
                {t('login.ssoFlowHint')}
            </div>
            {/* TODO(legacy-login-flag): 暂时隐藏本地密码登录入口, 等
                后端 PR 在 /v1/common/appconfig 暴露 legacy_password_login_off
                (或类似字段) 后, 改成读 WKApp.remoteConfig 字段动态切换.
                当前: SSO 启用 + 有 provider 时, 整块隐藏看效果. */}
            {false && (
                <LegacyPasswordSection
                    vm={vm}
                    startSsoLogin={startSsoLogin}
                    handleLogin={handleLogin}
                />
            )}
            {/* 下载入口前保留无文案分隔线，将主登录区与平台入口分开。 */}
            <div className="wk-login-content-download-divider" aria-hidden="true" />
            <div className="wk-login-content-download">
                <AndroidDownloadButton />
                <IOSDownloadButton />
            </div>
        </div>
    )
}


// 本地密码登录区域. SSO 启用时这一段默认折叠 (P0 反馈): 外部用户大多
// 没有 Octo 本地账号, 默认显示 SSO 主按钮 + 一行"使用密码登录"链接, 比
// 把表单常态展开干净.
//
// 触发自动展开的两种情况:
//   1) 用户主动点击 "使用密码登录" 链接
//   2) 用户尝试登录失败 (vm.loginAttemptFailed) — 此时多半已经把账号密码
//      填进去, 不能在失败一刻反过来把表单收起
//
// 折叠/展开切换是纯 UI 状态, 与 LoginVM 业务无关, 用本地 useState 持有.
const LegacyPasswordSection: React.FC<{
    vm: LoginVM
    startSsoLogin: () => void
    handleLogin: () => void
}> = ({ vm, startSsoLogin, handleLogin }) => {
    const [expanded, setExpanded] = useState(false)
    const open = expanded || vm.loginAttemptFailed

    if (!open) {
        return (
            <div className="wk-login-content-legacy-toggle">
                <a onClick={() => setExpanded(true)}>{t('login.passwordToggle')}</a>
            </div>
        )
    }
    return (
        <>
            <div className="wk-login-content-legacy-divider">
                <span>{t('login.passwordDivider')}</span>
            </div>
            <div className="wk-login-content-legacy-form">
                <input
                    type="text"
                    name="username"
                    autoComplete="username"
                    placeholder={t('form.email')}
                    onChange={(v) => { vm.username = v.target.value }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                />
                <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    placeholder={t('form.password')}
                    onChange={(v) => { vm.password = v.target.value }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}
                />
                <div className="wk-login-content-form-buttons">
                    <Button
                        loading={vm.loginLoading}
                        className="wk-login-content-form-ok"
                        type="primary"
                        theme="solid"
                        onMouseDown={(e: React.MouseEvent) => { e.preventDefault() }}
                        onClick={handleLogin}
                    >
                        {t('login.button')}
                    </Button>
                </div>
                {vm.loginAttemptFailed && (
                    <div className="wk-login-content-form-error-cta">
                        {t('login.passwordCta')}{' '}
                        <a onClick={(e) => { e.preventDefault(); startSsoLogin() }}>
                            {t('login.passwordCtaLink')}
                        </a>
                    </div>
                )}
                <div className="wk-login-content-form-others">
                    <div
                        className="wk-login-content-form-scanlogin"
                        onClick={() => { vm.loginType = LoginType.qrcode }}
                    >
                        {t('login.scanLogin')}
                    </div>
                    <div
                        className="wk-login-content-form-switch"
                        onClick={() => { vm.loginType = LoginType.forgetPassword }}
                    >
                        {t('login.forgotPassword')}
                    </div>
                </div>
            </div>
        </>
    )
}

// iOS 下载二维码通过 updater 接口获取；加载失败时不展示过期二维码。
// 实现见 ./IOSDownloadButton.tsx（抽成独立模块便于单测）。

// Known safe error messages from the server that can be shown to users
/**
 * Sanitize server error messages to prevent information leakage.
 * Only known safe messages are shown; unknown errors get a generic message.
 */
function sanitizeErrorMessage(msg: string): string {
    if (!msg || typeof msg !== "string") return t('validation.genericError');
    const knownKey = serverErrorKeyFromMessage(msg);
    if (knownKey) return t(`serverErrorDisplays.${knownKey}`);
    // Check if message looks safe (short, no HTML, no stack trace)
    if (msg.length <= 50 && !/[<>{}]|Error:|at /.test(msg)) {
        return msg;
    }
    console.warn("Suppressed raw server error:", msg);
    return t('validation.genericError');
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

type LoginState = {
    loginStatus: string
    loginUUID: string
    getLoginUUIDLoading: boolean
    scanner?: string  // 扫描者的uid
    qrcode?: string
}

interface SendCodeButtonProps {
    onSend: () => Promise<void>
    countdown: number
    className?: string
}

function SendCodeButton({ onSend, countdown, className }: SendCodeButtonProps) {
    const [loading, setLoading] = useState(false)
    const prevCountdown = useRef(countdown)

    // countdown 从 0 变成正数，说明发送成功倒计时开始，此时才清除 loading
    useEffect(() => {
        if (prevCountdown.current === 0 && countdown > 0) {
            setLoading(false)
        }
        prevCountdown.current = countdown
    }, [countdown])

    const disabled = countdown > 0 || loading
    const label = countdown > 0 ? `${countdown}s` : t('sendCode')
    return (
        <Button
            className={className}
            disabled={disabled}
            onClick={async () => {
                setLoading(true)
                try {
                    await onSend()
                } catch {
                    // 失败时立即清除 loading
                    setLoading(false)
                }
            }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
            {loading && (
                <svg
                    width="14" height="14"
                    viewBox="0 0 14 14"
                    style={{ flexShrink: 0, animation: 'wk-spin 0.8s linear infinite' }}
                >
                    <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="26" strokeDashoffset="10" strokeLinecap="round" />
                </svg>
            )}
            {label}
        </Button>
    )
}

class Login extends Component<any, LoginState> {
    // SSO 区域的可见性来自 WKApp.remoteConfig.oidcProviders, 而 appconfig 是异步加载的——
    // 登录页很可能在 fetch 完成前就先渲染了一次, 这时 oidcProviders 还是空数组,
    // SSO 按钮就不会显示。订阅 remoteConfig 的一次性「加载完成」事件触发 forceUpdate,
    // 让按钮在 appconfig 后到时自动出现, 用户无需手动刷新。
    private _unsubscribeRemoteConfig?: () => void
    private _unsubscribeRemoteConfigChange?: () => void

    componentDidMount() {
        const forceUpdate = () => {
            // 仓库里 React class 组件的 @types 解析有历史问题, this.forceUpdate / setState
            // 都识别不到 (NavSettingsPanel 等处同样如此)。这里同样走 cast 跟既有写法一致。
            ; (this as unknown as { forceUpdate(): void }).forceUpdate()
        }
        if (!WKApp.remoteConfig.requestSuccess) {
            this._unsubscribeRemoteConfig = WKApp.remoteConfig.addListener(forceUpdate)
        }
        this._unsubscribeRemoteConfigChange = WKApp.remoteConfig.addConfigChangeListener(forceUpdate)
    }

    componentWillUnmount() {
        this._unsubscribeRemoteConfig?.()
        this._unsubscribeRemoteConfigChange?.()
    }

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
                    Toast.error(t('validation.usernameRequired'))
                    return
                }
                if (!vm.password) {
                    Toast.error(t('validation.passwordRequired'))
                    return
                }
                vm.loginAttemptFailed = false
                vm.notifyListener()
                const onFail = (err: any) => {
                    Toast.error(sanitizeErrorMessage(err.msg))
                    vm.loginAttemptFailed = true
                    vm.notifyListener()
                }
                const isEmail = isValidEmail(vm.username)
                if (isEmail) {
                    vm.requestEmailLogin(vm.username, vm.password).catch(onFail)
                } else {
                    vm.requestLoginWithUsernameAndPwd(vm.username, vm.password).catch(onFail)
                }
            }

            // SSO 区块的展示和文案以本次渲染为准, 避免在多个 JSX 节点里重复调函数。
            // TODO(multi-provider): 后端字段已是数组, 但本期 oidc_providers.length ≤ 1,
            // 所以 UI(主 CTA、重置密码提示)统一取 [0]。多 IdP 落地时这里要改成 picker /
            // 按 loginInfo.loginProvider 路由各自的 reset URL, 同步检查 login.tsx:513。
            const ssoProvider = getSSOProviders()[0]
            const hasSsoProvider = !!ssoProvider

            const startSsoLogin = () => {
                if (!ssoProvider) return
                vm.startOidcLogin(ssoProvider.id).catch((err: unknown) => {
                    console.error('OIDC login start failed:', err)
                    Toast.error(t('login.ssoStartFailed', { values: { provider: ssoProvider.name } }))
                })
            }

            return <div className="wk-login">
                {/* Left brand panel */}
                <div className="wk-login-brand">
                    {/* Logo fixed top-left */}
                    <div className="wk-login-brand-logo-top">
                        <img className="wk-login-brand-logo-image" src={loginLogo} alt="Octo" />
                    </div>
                    <div className="wk-login-brand-inner">
                        <div className="wk-login-brand-copy">
                            <div className="wk-login-brand-headline">
                                {t('welcome.headline').split('\n').map((line, index) => (
                                    <React.Fragment key={line}>
                                        {index > 0 && <br />}
                                        {line}
                                    </React.Fragment>
                                ))}
                            </div>
                            <div className="wk-login-brand-subline">
                                {t('welcome.subline').split('\n').map((line, index) => (
                                    <React.Fragment key={line}>
                                        {index > 0 && <br />}
                                        {line}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                        {/* 3 个功能点已下线 (P1 反馈): 登录页不是营销页, 把 hero 留给左侧
                            chat 卡片预览即可. */}
                    </div>{/* end brand-inner */}

                    {/* Chat bubble decoration - absolute bottom */}
                    <div className="wk-login-brand-chat">
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--left">
                            <div className="wk-login-brand-chat-avatar">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
                            </div>
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-name">Octo AI</div>
                                <div className="wk-login-brand-chat-text">{t('welcome.chat1')}</div>
                            </div>
                        </div>
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--right">
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-text">{t('welcome.chat2')}</div>
                            </div>
                        </div>
                        <div className="wk-login-brand-chat-bubble wk-login-brand-chat-bubble--left">
                            <div className="wk-login-brand-chat-avatar">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z" /></svg>
                            </div>
                            <div className="wk-login-brand-chat-content">
                                <div className="wk-login-brand-chat-name">Octo AI</div>
                                <div className="wk-login-brand-chat-text">{t('welcome.chat3')}</div>
                            </div>
                        </div>
                    </div>
                </div>{/* end wk-login-brand */}

                {/* Right form panel */}
                <div className="wk-login-panel">
                    {ENTERPRISE_SSO_ENABLED && <OidcResumeEffect vm={vm} />}
                    {ENTERPRISE_SSO_ENABLED && <OidcResumingOverlay vm={vm} />}
                    {/* 顶部小面包屑: 紫色圆点 + 当前登录目标. 给到达 /login 的人一个
                        "我在哪 / 这个表单会把我送去哪" 的轻确认, 不抢主标题视觉权重. */}
                    <div className="wk-login-panel-breadcrumb">
                        <span className="wk-login-panel-breadcrumb-dot" />
                        <span className="wk-login-panel-breadcrumb-text">
                            {t('login.breadcrumb', { values: { appName: WKApp.config.appName || 'Octo' } })}
                        </span>
                    </div>
                    <LoginLanguageSwitcher />
                    <div className="wk-login-content">
                        {vm.inviteInfo && (
                            <div className="wk-login-invite-banner">
                                <div>{t('login.invite')} <strong>{vm.inviteInfo.space_name}</strong></div>
                                <div>{vm.inviteInfo.max_users > 0
                                    ? t('login.memberCountWithMax', { values: { count: vm.inviteInfo.member_count, max: vm.inviteInfo.max_users } })
                                    : t('login.memberCount', { values: { count: vm.inviteInfo.member_count } })}</div>
                            </div>
                        )}
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.phone ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">{t('login.welcome')}</div>
                            {(!ENTERPRISE_SSO_ENABLED || !hasSsoProvider) && (
                                <div className="wk-login-content-slogan-sub">{t('login.defaultSub')}</div>
                            )}
                            {ENTERPRISE_SSO_ENABLED && hasSsoProvider ? (
                                // SSO 启用：统一认证作为主 CTA，注册入口和流程提示保持次级。
                                <SsoLoginPanel
                                    vm={vm}
                                    ssoProvider={ssoProvider!}
                                    startSsoLogin={startSsoLogin}
                                    handleLogin={handleLogin}
                                />
                            ) : (
                                // 未启用 SSO：保持原有布局（含本地注册入口）
                                <div className="wk-login-content-form">
                                    <input type="text" name="username" autoComplete="username" placeholder={t('form.email')} onChange={(v) => {
                                        vm.username = v.target.value
                                    }} onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}></input>
                                    <input type="password" name="password" autoComplete="current-password" placeholder={t('form.password')} onChange={(v) => {
                                        vm.password = v.target.value
                                    }} onKeyDown={(e) => { if (e.key === 'Enter') handleLogin() }}></input>
                                    <div className="wk-login-content-form-buttons">
                                        <Button loading={vm.loginLoading} className="wk-login-content-form-ok" type='primary' theme='solid'
                                            onMouseDown={(e: React.MouseEvent) => { e.preventDefault() }}
                                            onClick={handleLogin}>{t('login.button')}</Button>
                                    </div>
                                    <div className="wk-login-content-form-others">
                                        <div className="wk-login-content-form-scanlogin" onClick={() => {
                                            vm.loginType = LoginType.qrcode
                                        }}>
                                            {t('login.scanLogin')}
                                        </div>
                                        <div className="wk-login-content-form-switch" onClick={() => {
                                            vm.loginType = LoginType.register
                                        }}>
                                            {t('login.noAccountRegister')}
                                        </div>
                                        <div className="wk-login-content-form-switch" onClick={() => {
                                            vm.loginType = LoginType.forgetPassword
                                        }}>
                                            {t('login.forgotPassword')}
                                        </div>
                                    </div>
                                    {/* 与 SSO 分支一致，保留无文案分隔线。 */}
                                    <div className="wk-login-content-download-divider" aria-hidden="true" />
                                    <div className="wk-login-content-download">
                                        <AndroidDownloadButton />
                                        <IOSDownloadButton />
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.register ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">{t('register.title')}</div>
                            <div className="wk-login-content-slogan-sub">{t('register.sub', { values: { appName: WKApp.config.appName || 'Octo' } })}</div>
                            <div className="wk-login-content-form">
                                <input type="email" name="reg-email" autoComplete="email" placeholder={t('form.email')} onChange={(v) => {
                                    vm.registerEmail = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-code-row">
                                    <input type="text" name="reg-code" autoComplete="one-time-code" placeholder={t('form.emailCode')} onChange={(v) => {
                                        vm.registerEmailCode = v.target.value
                                    }}></input>
                                    <SendCodeButton
                                        className="wk-login-content-form-code-btn"
                                        countdown={vm.registerCodeCountdown}
                                        onSend={async () => {
                                            const regEmailEl = document.querySelector<HTMLInputElement>('input[name="reg-email"]')
                                            if (regEmailEl?.value && !vm.registerEmail) vm.registerEmail = regEmailEl.value
                                            if (!vm.registerEmail || !isValidEmail(vm.registerEmail)) {
                                                Toast.error(t('validation.emailInvalidBeforeSend'))
                                                return
                                            }
                                            await vm.requestRegisterSendCode(vm.registerEmail).catch((err: any) => {
                                                Toast.error(sanitizeErrorMessage(err.msg))
                                            })
                                        }}
                                    />
                                </div>
                                <input type="text" name="reg-name" autoComplete="name" placeholder={t('form.nickname')} onChange={(v) => {
                                    vm.registerEmailName = v.target.value
                                }}></input>
                                <input type="password" name="reg-password" autoComplete="off" placeholder={t('form.password')} onChange={(v) => {
                                    vm.registerEmailPassword = v.target.value
                                    vm.notifyListener()
                                }}></input>
                                <PasswordStrengthIndicator password={vm.registerEmailPassword || ''} />
                                <input type="password" name="reg-confirm-password" autoComplete="off" placeholder={t('form.confirmPassword')} onChange={(v) => {
                                    vm.registerEmailConfirmPassword = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-buttons">
                                    <Button loading={vm.registerLoading} className="wk-login-content-form-ok" type='primary' theme='solid' onClick={async () => {
                                        // 兼容移动端自动填充不触发 onChange
                                        const regEmailEl = document.querySelector<HTMLInputElement>('input[name="reg-email"]')
                                        const regCodeEl = document.querySelector<HTMLInputElement>('input[name="reg-code"]')
                                        const regNameEl = document.querySelector<HTMLInputElement>('input[name="reg-name"]')
                                        const regPwdEl = document.querySelector<HTMLInputElement>('input[name="reg-password"]')
                                        const regConfirmEl = document.querySelector<HTMLInputElement>('input[name="reg-confirm-password"]')
                                        if (regEmailEl?.value && !vm.registerEmail) vm.registerEmail = regEmailEl.value
                                        if (regCodeEl?.value && !vm.registerEmailCode) vm.registerEmailCode = regCodeEl.value
                                        if (regNameEl?.value && !vm.registerEmailName) vm.registerEmailName = regNameEl.value
                                        if (regPwdEl?.value && !vm.registerEmailPassword) vm.registerEmailPassword = regPwdEl.value
                                        if (regConfirmEl?.value && !vm.registerEmailConfirmPassword) vm.registerEmailConfirmPassword = regConfirmEl.value

                                        if (!vm.registerEmail || !isValidEmail(vm.registerEmail)) {
                                            Toast.error(t('validation.emailInvalid'))
                                            return
                                        }
                                        if (!vm.registerEmailCode) {
                                            Toast.error(t('validation.emailCodeRequired'))
                                            return
                                        }
                                        if (!vm.registerEmailName) {
                                            Toast.error(t('validation.nicknameRequired'))
                                            return
                                        }
                                        const passwordError = validatePassword(vm.registerEmailPassword || '');
                                        if (passwordError) {
                                            Toast.error(passwordError)
                                            return
                                        }
                                        if (vm.registerEmailPassword !== vm.registerEmailConfirmPassword) {
                                            Toast.error(t('validation.passwordMismatch'))
                                            return
                                        }
                                        vm.requestEmailRegister(vm.registerEmail!, vm.registerEmailPassword!, vm.registerEmailName!, vm.registerEmailCode!).catch((err) => {
                                            Toast.error(sanitizeErrorMessage(err.msg))
                                        })
                                    }}>{t('register.button')}</Button>
                                </div>
                                <div className="wk-login-content-form-others">
                                    <div className="wk-login-content-form-switch" onClick={() => {
                                        vm.loginType = LoginType.phone
                                    }}>
                                        {t('register.hasAccount')}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="wk-login-content-phonelogin" style={{ "display": vm.loginType === LoginType.forgetPassword ? "block" : "none" }}>
                            <div className="wk-login-content-slogan">{t('reset.title')}</div>
                            <div className="wk-login-content-slogan-sub">{t('reset.sub')}</div>
                            {ENTERPRISE_SSO_ENABLED && ssoProvider?.resetPasswordUrl && (
                                <div className="wk-login-content-form-oidc-hint">
                                    {t('reset.oidcHintPrefix')}
                                    <a
                                        href={ssoProvider.resetPasswordUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                    >
                                        {t('reset.accountCenter', { values: { provider: ssoProvider.name } })}
                                    </a>
                                    {t('reset.oidcHintSuffix')}
                                </div>
                            )}
                            <div className="wk-login-content-form">
                                <input type="email" name="forget-email" autoComplete="email" placeholder={t('form.registeredEmail')} onChange={(v) => {
                                    vm.forgetEmail = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-code-row">
                                    <input type="text" name="forget-code" autoComplete="one-time-code" placeholder={t('form.code')} onChange={(v) => {
                                        vm.forgetCode = v.target.value
                                    }}></input>
                                    <SendCodeButton
                                        className="wk-login-content-form-code-btn"
                                        countdown={vm.emailCodeCountdown}
                                        onSend={async () => {
                                            if (!vm.forgetEmail || !isValidEmail(vm.forgetEmail)) {
                                                Toast.error(t('validation.emailInvalid'))
                                                return
                                            }
                                            await vm.requestEmailSendCode(vm.forgetEmail!, 2).catch((err: any) => {
                                                Toast.error(sanitizeErrorMessage(err.msg))
                                            })
                                        }}
                                    />                                </div>
                                <input type="password" name="forget-new-pwd" autoComplete="off" placeholder={t('form.newPassword')} onChange={(v) => {
                                    vm.forgetNewPassword = v.target.value
                                    vm.notifyListener()
                                }}></input>
                                <PasswordStrengthIndicator password={vm.forgetNewPassword || ''} />
                                <input type="password" name="forget-confirm-pwd" autoComplete="off" placeholder={t('form.confirmNewPassword')} onChange={(v) => {
                                    vm.forgetConfirmPassword = v.target.value
                                }}></input>
                                <div className="wk-login-content-form-buttons">
                                    <Button loading={vm.forgetLoading} className="wk-login-content-form-ok" type='primary' theme='solid' onClick={async () => {
                                        if (!vm.forgetEmail || !isValidEmail(vm.forgetEmail)) {
                                            Toast.error(t('validation.emailInvalid'))
                                            return
                                        }
                                        if (!vm.forgetCode) {
                                            Toast.error(t('validation.codeRequired'))
                                            return
                                        }
                                        const newPasswordError = validatePassword(vm.forgetNewPassword || '');
                                        if (newPasswordError) {
                                            Toast.error(newPasswordError)
                                            return
                                        }
                                        if (vm.forgetNewPassword !== vm.forgetConfirmPassword) {
                                            Toast.error(t('validation.passwordMismatch'))
                                            return
                                        }
                                        vm.requestForgetPassword(vm.forgetEmail!, vm.forgetCode!, vm.forgetNewPassword!).then(() => {
                                            Toast.success(t('validation.resetSuccess'))
                                            vm.loginType = LoginType.phone
                                        }).catch((err) => {
                                            Toast.error(sanitizeErrorMessage(err.msg))
                                        })
                                    }}>{t('reset.button')}</Button>
                                </div>
                                <div className="wk-login-content-form-others">
                                    <div className="wk-login-content-form-switch" onClick={() => {
                                        vm.loginType = LoginType.phone
                                    }}>
                                        {t('common.backLogin')}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className={classNames("wk-login-content-scanlogin", vm.loginType === LoginType.qrcode ? "wk-login-content-scanlogin-show" : undefined)}>
                            <div className="wk-login-content-scanlogin-qrcode-title">{t('qr.title')}</div>
                            <div className="wk-login-content-scanlogin-qrcode-subtitle">{t('qr.subtitle')}</div>

                            {/* QR code card */}
                            <div className="wk-login-qr-card">
                                <Spin size="large" spinning={vm.qrcodeLoading}>
                                    <div className="wk-login-content-scanlogin-qrcode-wrap">
                                        <div className="wk-login-content-scanlogin-qrcode">
                                            {vm.qrcodeLoading || !vm.qrcode ? undefined : <QRCodeSVG value={vm.qrcode} size={176} fgColor={WKApp.config.themeColor}></QRCodeSVG>}
                                            <div className={classNames("wk-login-content-scanlogin-qrcode-avatar", vm.showAvatar() ? "wk-login-content-scanlogin-qrcode-avatar-show" : undefined)}>
                                                {vm.showAvatar() ? <img src={WKApp.shared.avatarUser(vm.uid!)}></img> : undefined}
                                            </div>
                                            {!vm.autoRefresh ? <div className="wk-login-content-scanlogin-qrcode-expire">
                                                <p>{t('qr.expired')}</p>
                                                <img onClick={() => { vm.reStartAdvance() }} src={require("./assets/refresh.png")}></img>
                                            </div> : undefined}
                                        </div>
                                    </div>
                                </Spin>
                                <div className="wk-login-qr-tip">{t('qr.tip', { values: { appName: WKApp.config.appName || 'Octo' } })}</div>
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
                                    <div className="wk-login-qr-step-title">{t('qr.appStepTitle')}</div>
                                    <div className="wk-login-qr-step-desc">{t('qr.appStepDesc', { values: { appName: WKApp.config.appName || 'Octo' } })}</div>
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
                                    <div className="wk-login-qr-step-title">{t('qr.scanStepTitle')}</div>
                                    <div className="wk-login-qr-step-desc">{t('qr.scanStepDesc')}</div>
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
                                    <div className="wk-login-qr-step-title">{t('qr.confirmStepTitle')}</div>
                                    <div className="wk-login-qr-step-desc">{t('qr.confirmStepDesc')}</div>
                                </div>
                            </div>

                            <div className="wk-login-footer-buttons">
                                <button onClick={() => { vm.loginType = LoginType.phone }}>{t('qr.accountPassword')}</button>
                            </div>
                        </div>
                    </div>
                    {/* 右下底栏: 版权, 固定在 panel 底部居中. */}
                    <div className="wk-login-panel-footer">
                        <span>© {new Date().getFullYear()} {WKApp.config.appName || 'Octo'}</span>
                        <span>
                            {t('login.designedBy')}{' '}
                            <a
                                href="https://www.mininglamp.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                            >Mininglamp</a>
                        </span>
                    </div>
                </div>{/* end wk-login-panel */}
            </div>
        }}>

        </Provider>
    }
}

export default Login
