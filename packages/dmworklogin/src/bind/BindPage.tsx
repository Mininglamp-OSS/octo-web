import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Spin, Toast } from '@douyinfe/semi-ui'
import { WKApp } from '@octo/base'
import {
  clearPendingOidcLogin,
  fetchHttpClient,
  OidcBindHttpError,
} from '../oidc'
import {
  fetchBindInfo,
  verifyBindPassword,
  sendBindOtp,
  checkBindOtp,
  confirmBind,
  createBind,
  parseBindEntryParams,
  clearBindUrl,
  FALLBACK_PROVIDER_ID,
  type BindEntryParams,
  type BindInfoResp,
  type BindMethod,
  type BindApiOptions,
} from '../oidc/bind'
import { applyLoginResp, parseLoginResp } from '../loginSession'
import { mapBindError, type BindEndpoint, type BindErrorDisplay } from './errorMessages'
import { loginT as t } from '../i18n'
import './bind.css'

type Stage =
  | { kind: 'init' }
  | { kind: 'loading_info' }
  | { kind: 'choose_method'; info: BindInfoResp }
  | { kind: 'verify_password'; info: BindInfoResp }
  | { kind: 'verify_otp'; info: BindInfoResp; sent: boolean; sending: boolean }
  | { kind: 'confirming'; info: BindInfoResp }
  | { kind: 'creating'; info: BindInfoResp }
  | { kind: 'success' }
  | { kind: 'fatal'; display: BindErrorDisplay }

// 把 info.allow_create / create_blocked 折叠成 UI 三态. PR#93 钦定: 只在
// allow_create=true && create_blocked==='' 时显示可点的主创建按钮.
type CreateState =
  | { kind: 'available' }                       // 可点
  | { kind: 'hidden' }                           // 不渲染 (disabled 开关 / 老后端无字段)
  | { kind: 'blocked'; reason: string }          // 渲染说明文字, 不渲染按钮

function deriveCreateState(info: BindInfoResp): CreateState {
  if (info.allow_create !== true) return { kind: 'hidden' }
  const blocked = info.create_blocked ?? ''
  if (blocked === '') return { kind: 'available' }
  // 'disabled' 这一支虽然 allow_create 应该已经是 false, 但后端 PR#93 precedence
  // 是 disabled > claims_incomplete > manual_conflict > consumed, 防御性兜底.
  if (blocked === 'disabled') return { kind: 'hidden' }
  if (blocked === 'claims_incomplete') {
    return { kind: 'blocked', reason: t('bind.blocked.claimsIncomplete') }
  }
  if (blocked === 'manual_conflict') {
    return { kind: 'blocked', reason: t('bind.blocked.manualConflict') }
  }
  if (blocked === 'consumed') {
    return { kind: 'blocked', reason: t('bind.blocked.consumed') }
  }
  return { kind: 'hidden' }
}

interface BindPageProps {
  // 由 BindModule.init() 在 RouteManager 的 pageshow handler 冲掉 URL 之前
  // 抓到的 location.search 快照. 不直接读 window.location.search 是因为
  // RouteManager 会在 pageshow 时 push 一个带 sid= 的 URL, 把 bind 入口参数
  // 全部丢掉.
  initialSearch: string
}

const BindPage = ({ initialSearch }: BindPageProps) => {
  // bind_token 与 entry 参数全程只在 useRef 持有, 不进 React state, 不进任何 store.
  // 见 oidc-bind-frontend.md §2.2 — 这是 bind_token-in-URL 已知 limitation 的核心缓解.
  const entryRef = useRef<BindEntryParams | null>(null)
  const initRanRef = useRef(false)

  const [stage, setStage] = useState<Stage>({ kind: 'init' })
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  useEffect(() => {
    if (initRanRef.current) return
    initRanRef.current = true

    const params = parseBindEntryParams(initialSearch)
    // **顺序很关键**: 先 capture 到 ref, 再清 URL. 反过来会丢 token.
    if (params) entryRef.current = params
    clearBindUrl()

    if (!params) {
      setStage({
        kind: 'fatal',
        display: { message: t('bind.invalidLink'), terminal: true },
      })
      return
    }

    void loadInfo(params)
  }, [])

  const apiOpts = (): BindApiOptions => ({
    provider: entryRef.current?.provider,
    telemetry: {
      onProviderFallback: (reason) => {
        // 上报埋点便于排查 redirect 没带 provider 的部署. 不打 token, 不打具体值,
        // 只记一次 reason. WKApp 没暴露埋点 API, 这里挂在 window 对象上让运维抓.
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(window as any).__bindProviderFallback = reason
        } catch {
          /* noop */
        }
      },
    },
  })

  async function loadInfo(params: BindEntryParams): Promise<void> {
    setStage({ kind: 'loading_info' })
    setInlineError(null)
    try {
      const info = await fetchBindInfo(fetchHttpClient, params.token, apiOpts())
      const createState = deriveCreateState(info)
      // 用户能进入选择阶段的条件: 至少有一个可用的 verify method OR create 可点.
      // create 被 block 但仍渲染原因文字时, 只要还有 verify methods 也能进 choose_method;
      // create + verify 都死才落 fatal.
      const hasAnyAction =
        info.methods.length > 0 || createState.kind === 'available'
      if (!hasAnyAction) {
        // create 被 blocked 而 methods 空 → 把 blocked 原因当 fatal 文案, 比泛"无可用绑定方式"更有信息.
        const message =
          createState.kind === 'blocked'
            ? createState.reason
            : info.support_contact
              ? t('bind.noMethodContact', { values: { contact: info.support_contact } })
              : t('bind.noMethodContactAdmin')
        setStage({
          kind: 'fatal',
          display: { message, terminal: true },
        })
        return
      }
      setStage({ kind: 'choose_method', info })
    } catch (err) {
      setStage({ kind: 'fatal', display: mapBindError('info', err) })
    }
  }

  function handleError(endpoint: BindEndpoint, err: unknown): void {
    const display = mapBindError(endpoint, err)
    if (display.terminal) {
      setStage({ kind: 'fatal', display })
    } else {
      setInlineError(display.message)
    }
  }

  async function onSelectMethod(m: BindMethod): Promise<void> {
    if (stage.kind !== 'choose_method') return
    setInlineError(null)
    if (m === 'password') {
      setStage({ kind: 'verify_password', info: stage.info })
      return
    }
    // sms_otp: 自动发送一次
    setStage({ kind: 'verify_otp', info: stage.info, sent: false, sending: true })
    try {
      const token = entryRef.current?.token
      if (!token) return
      await sendBindOtp(fetchHttpClient, token, apiOpts())
      setStage({ kind: 'verify_otp', info: stage.info, sent: true, sending: false })
      Toast.success(t('bind.otp.sent'))
    } catch (err) {
      setStage({ kind: 'verify_otp', info: stage.info, sent: false, sending: false })
      handleError('verify_otp_send', err)
    }
  }

  async function onResendOtp(): Promise<void> {
    if (stage.kind !== 'verify_otp') return
    const token = entryRef.current?.token
    if (!token) return
    setBusy(true)
    setInlineError(null)
    try {
      await sendBindOtp(fetchHttpClient, token, apiOpts())
      Toast.success(t('bind.otp.resent'))
      setStage({ ...stage, sent: true })
    } catch (err) {
      handleError('verify_otp_send', err)
    } finally {
      setBusy(false)
    }
  }

  // 后端 verify_* 返 409 = "session 已 verified 或更高"; 文档 §3.2 把它定为
  // "用户已经通过了, 重复 verify 被 CAS 拒". 正确响应是直接 advance 到 confirm,
  // 而不是给用户看 inline error "请继续完成绑定" — 那个文案承诺了"继续", 但
  // 之前的实现只 setInlineError, 用户点"验证并绑定"又 409, 死循环. PR #72 W2.
  function isVerifyAlreadyConsumed(err: unknown): boolean {
    return err instanceof OidcBindHttpError && err.status === 409
  }

  async function onSubmitPassword(): Promise<void> {
    if (stage.kind !== 'verify_password') return
    if (!identifier || !password) {
      setInlineError(t('bind.validation.accountPasswordRequired'))
      return
    }
    const token = entryRef.current?.token
    if (!token) return
    setBusy(true)
    setInlineError(null)
    try {
      await verifyBindPassword(fetchHttpClient, token, identifier, password, apiOpts())
      // verify 通过后立即清密码, 不留在 React state 里
      setPassword('')
      await runConfirm(stage.info)
    } catch (err) {
      if (isVerifyAlreadyConsumed(err)) {
        setPassword('')
        await runConfirm(stage.info)
        return
      }
      handleError('verify_password', err)
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitOtp(): Promise<void> {
    if (stage.kind !== 'verify_otp') return
    // 后端短信验证码长度固定为 6 位 (BindService.VerifyOTPCheck);
    // input 的 maxLength={6} 已经卡上限, 这里卡下限避免半截 OTP 提交后被 401.
    if (!otp || otp.length < 6) {
      setInlineError(t('bind.validation.otpRequired'))
      return
    }
    const token = entryRef.current?.token
    if (!token) return
    setBusy(true)
    setInlineError(null)
    try {
      await checkBindOtp(fetchHttpClient, token, otp, apiOpts())
      setOtp('')
      await runConfirm(stage.info)
    } catch (err) {
      if (isVerifyAlreadyConsumed(err)) {
        setOtp('')
        await runConfirm(stage.info)
        return
      }
      handleError('verify_otp_check', err)
    } finally {
      setBusy(false)
    }
  }

  // PR #72 round-4 (Jerry-Xin): bind success must honour any pendingInviteCode
  // set by LoginVM.didMount when the user arrived via /login?invite=X. The
  // legacy LoginVM.loginSuccess routes that through WKApp.endpoints.callOnLogin
  // → AppLayout.onLogin which handles /space/invite + /space/join + cleanup +
  // navigation. We can't just call callOnLogin from /oidc/bind directly
  // because AppLayout.onLogin computes basePath off window.location.pathname,
  // which would send the user back to /oidc/bind — so we replaceState to '/'
  // first.
  //
  // Validation matches LoginVM and AppLayout: pendingInviteCode must look like
  // a safe slug. Anything else falls through to the plain returnTo navigation.
  function finalizeBindSuccess(returnTo: string): void {
    setStage({ kind: 'success' })

    let pendingInvite: string | null = null
    try {
      pendingInvite = localStorage.getItem('pendingInviteCode')
    } catch {
      /* localStorage unavailable — treat as no invite */
    }

    if (pendingInvite && /^[a-zA-Z0-9_-]+$/.test(pendingInvite)) {
      // Hand off to AppLayout.onLogin. It will:
      //   1. fetch /space/invite/<code>, then /space/join
      //   2. clear pendingInviteCode on success
      //   3. compute basePath from location.pathname → goMain
      // We replaceState pathname to '/' so basePath resolves to '/' instead of
      // '/oidc/bind' (which would loop the user back to BindPage).
      try {
        window.history.replaceState({}, '', '/')
      } catch {
        /* noop: SSR / legacy host */
      }
      try {
        WKApp.endpoints.callOnLogin()
      } catch (e) {
        console.warn('callOnLogin error suppressed:', e)
        // Last-resort fallback so the user isn't stranded on the success stage.
        window.location.replace('/')
      }
      return
    }

    // No invite — keep the original behaviour: short paint window then navigate
    // to the originally-requested return_to.
    window.setTimeout(() => {
      try {
        window.location.replace(returnTo)
      } catch {
        window.location.href = returnTo
      }
    }, 200)
  }

  async function runConfirm(info: BindInfoResp): Promise<void> {
    // Read entryRef and validate the invariants *before* setStage so a stale
    // entryRef can't park the user on the confirming loader with no recovery.
    // PR #72 review yujiawei P2-2.
    const token = entryRef.current?.token
    const returnTo = postLoginReturnTo(entryRef.current?.returnTo)
    if (!token) {
      handleError('confirm', new Error('missing bind token'))
      return
    }
    setStage({ kind: 'confirming', info })
    try {
      const resp = await confirmBind(fetchHttpClient, token, apiOpts())
      // login_resp 是 JSON-encoded string, JSON.parse 后与老 OIDC authstatus.result 同 schema.
      const data = parseLoginResp(resp.login_resp)
      // loginProvider 必须落到真实 IdP id, 下游 NavSettingsPanel /
      // realnameVerifyUrl / login.tsx reset-password 都按 id 在 oidcProviders 里
      // find, 写 'oidc-bind' 这种 synthetic 值会让所有 lookup fails closed.
      // 与 legacy login_vm.loginSuccess(pending.providerId) 对齐, 使用 entry.provider,
      // 缺失时回退 FALLBACK_PROVIDER_ID — resolveProvider() 在 api 层已是同一语义.
      applyLoginResp(data, entryRef.current?.provider || FALLBACK_PROVIDER_ID)
      // bind 已经把 login 态写入 loginInfo; 同一 tab 上 /login 的 OidcResumeEffect
      // 若读到旧 pending 会再 poll 一次浪费 1-2s. 清掉避免冗余.
      try { clearPendingOidcLogin() } catch { /* sessionStorage 不可用时静默 */ }
      // 写完登录态后 token 已无效 (后端 single-use consume), 直接清掉 ref.
      entryRef.current = null
      finalizeBindSuccess(returnTo)
    } catch (err) {
      // All confirm failures are terminal in errorMessages.ts — the confirming
      // loader has no surface to show an inline error, so handleError will
      // route to the fatal stage with a "返回登录" CTA.
      handleError('confirm', err)
    }
  }

  async function runCreate(info: BindInfoResp): Promise<void> {
    // See runConfirm: validate before setStage so a stale entryRef can't park
    // the user on the creating loader. PR #72 review yujiawei P2-2.
    const token = entryRef.current?.token
    const returnTo = postLoginReturnTo(entryRef.current?.returnTo)
    if (!token) {
      handleError('create', new Error('missing bind token'))
      return
    }
    setStage({ kind: 'creating', info })
    try {
      const resp = await createBind(fetchHttpClient, token, apiOpts())
      // 与 confirm 同 schema 同 builder, login_resp 直接 parseLoginResp + applyLoginResp.
      const data = parseLoginResp(resp.login_resp)
      // 同 runConfirm — loginProvider 必须是真实 IdP id, 不是
      // 'oidc-bind-create' 这种 synthetic 标签. 见 runConfirm 上方注释.
      applyLoginResp(data, entryRef.current?.provider || FALLBACK_PROVIDER_ID)
      try { clearPendingOidcLogin() } catch { /* sessionStorage 不可用时静默 */ }
      entryRef.current = null
      finalizeBindSuccess(returnTo)
    } catch (err) {
      // create failures are deterministic at bindCreateMax=1 — handleError routes
      // to fatal.
      handleError('create', err)
    }
  }

  function goBackToLogin(): void {
    entryRef.current = null
    window.location.replace('/login')
  }

  // ---- render ------------------------------------------------------------
  return (
    <div className="wk-bind">
      <div className="wk-bind-card">
        <h2 className="wk-bind-title">{t('bind.title')}</h2>
        {/* fatal 状态下隐藏教学话术 — 已经报错了, 用户不需要再被告知"为什么在这" */}
        {stage.kind !== 'fatal' ? (
          <p className="wk-bind-subtitle">
            {stage.kind === 'success'
              ? t('bind.success')
              : t('bind.subtitle')}
          </p>
        ) : null}

        {stage.kind === 'loading_info' || stage.kind === 'init' ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin />
          </div>
        ) : null}

        {stage.kind === 'fatal' ? (
          <>
            <div className="wk-bind-error" data-severity="hard">{stage.display.message}</div>
            <div className="wk-bind-actions">
              <Button type="primary" theme="solid" onClick={goBackToLogin}>
                {t('common.backLogin')}
              </Button>
            </div>
          </>
        ) : null}

        {stage.kind === 'success' ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin />
          </div>
        ) : null}

        {stage.kind === 'choose_method' ||
        stage.kind === 'verify_password' ||
        stage.kind === 'verify_otp' ||
        stage.kind === 'confirming' ||
        stage.kind === 'creating' ? (
          <IdentityBlock info={(stage as { info: BindInfoResp }).info} />
        ) : null}

        {stage.kind === 'choose_method'
          ? renderChooseMethod(stage.info, busy, onSelectMethod, () =>
              void runCreate(stage.info),
            )
          : null}

        {stage.kind === 'creating' ? (
          <div className="wk-bind-loader">
            <Spin size="large" />
            <div className="wk-bind-loader-title">{t('bind.creatingAccount')}</div>
            <div className="wk-bind-loader-sub">{t('bind.loaderSub')}</div>
          </div>
        ) : null}

        {stage.kind === 'verify_password' ? (
          <>
            {inlineError ? <div className="wk-bind-error" data-severity="soft">{inlineError}</div> : null}
            <div className="wk-bind-field">
              <label htmlFor="bind-username">{t('bind.passwordAccount')}</label>
              <Input
                id="bind-username"
                size="large"
                value={identifier}
                onChange={setIdentifier}
                disabled={busy}
                autoComplete="username"
              />
            </div>
            <div className="wk-bind-field">
              <label htmlFor="bind-password">{t('bind.passwordLabel')}</label>
              <Input
                id="bind-password"
                size="large"
                type="password"
                mode="password"
                value={password}
                onChange={setPassword}
                disabled={busy}
                autoComplete="current-password"
              />
            </div>
            <div className="wk-bind-actions">
              <Button
                onClick={() => {
                  setIdentifier('')
                  setPassword('')
                  setInlineError(null)
                  setStage({ kind: 'choose_method', info: stage.info })
                }}
                disabled={busy}
              >
                {t('common.back')}
              </Button>
              <Button
                type="primary"
                theme="solid"
                loading={busy}
                onClick={onSubmitPassword}
              >
                {t('bind.submit')}
              </Button>
            </div>
          </>
        ) : null}

        {stage.kind === 'verify_otp' ? (
          <>
            {inlineError ? <div className="wk-bind-error" data-severity="soft">{inlineError}</div> : null}
            <div className="wk-bind-field">
              <label htmlFor="bind-otp">{t('bind.otp.label')}</label>
              <Input
                id="bind-otp"
                size="large"
                value={otp}
                onChange={setOtp}
                disabled={busy || stage.sending}
                maxLength={6}
                autoComplete="one-time-code"
              />
              <div className="wk-bind-otp-hint">
                {t('bind.otp.sentTo')}{' '}
                {stage.info.masked_phone ?? t('bind.otp.fallbackPhone')}
                {' · '}
                <a
                  onClick={() => {
                    if (!busy && !stage.sending) void onResendOtp()
                  }}
                  style={{ cursor: busy || stage.sending ? 'not-allowed' : 'pointer' }}
                >
                  {t('bind.otp.resend')}
                </a>
              </div>
            </div>
            <div className="wk-bind-actions">
              <Button
                onClick={() => {
                  setOtp('')
                  setInlineError(null)
                  setStage({ kind: 'choose_method', info: stage.info })
                }}
                disabled={busy}
              >
                {t('common.back')}
              </Button>
              <Button
                type="primary"
                theme="solid"
                loading={busy}
                disabled={stage.sending}
                onClick={onSubmitOtp}
              >
                {t('bind.submit')}
              </Button>
            </div>
          </>
        ) : null}

        {stage.kind === 'confirming' ? (
          <div className="wk-bind-loader">
            <Spin size="large" />
            <div className="wk-bind-loader-title">{t('bind.validating')}</div>
            <div className="wk-bind-loader-sub">{t('bind.loaderSub')}</div>
          </div>
        ) : null}

        {stage.kind !== 'init' &&
        stage.kind !== 'loading_info' &&
        stage.kind !== 'fatal' &&
        stage.kind !== 'success' &&
        stage.kind !== 'creating' ? (
          <div className="wk-bind-footer">
            {(stage as { info: BindInfoResp }).info.support_contact ? (
              <>
                {t('bind.footerContact')}{' '}
                <a href={`mailto:${(stage as { info: BindInfoResp }).info.support_contact}`}>
                  {(stage as { info: BindInfoResp }).info.support_contact}
                </a>
              </>
            ) : (
              <span>{t('bind.footerContactAdmin')}</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * choose_method 阶段的渲染. 反转后的 UX:
 *   主路径: 使用 SSO 身份直接创建 Octo 账号 (单击, 走 /bind/create)
 *   次路径: 已有 Octo 账号 → 用密码 / 短信验证绑定 (展开 verify methods)
 *
 * create 不可用 (老后端不返 allow_create / 运维关掉 / claims 不够) 时, 主区域
 * 留空或显示 blocked 原因, 次路径回退成"唯一路径".
 */
// 后端清洗 return_to 时会保留路径段, 常见就是原 authorize 时传的 /login.
// 但我们已经在 bind 流程里把登录态写好了, 跳回 /login 会触发 Layout 的
// "pathname 是 /login 强制显示登录页"守卫, 让用户看到一闪的登录表单 + 二次
// OidcResume 冗余 poll. 这里把 /login 提到主页. 其它 / 开头的路径保持不变.
function postLoginReturnTo(raw: string | undefined): string {
  const value = raw ?? '/'
  // 仅在精确 /login 与 /login?... 上替换, 不动 /login-history 这种前缀同形路径.
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) {
    return '/'
  }
  return value
}

// 次入口引导文案. 按 methods[] 实际给的方式拼, 避免写死"密码或短信"误导用户.
function secondaryHintFor(methods: BindMethod[]): string {
  const labels: string[] = []
  if (methods.includes('password')) labels.push(t('bind.method.password'))
  if (methods.includes('sms_otp')) labels.push(t('bind.method.sms'))
  if (labels.length === 0) return t('bind.noMethod')
  return t('bind.secondaryHint', { values: { methods: labels.join(t('bind.or')) } })
}

function renderChooseMethod(
  info: BindInfoResp,
  busy: boolean,
  onSelectMethod: (m: BindMethod) => void,
  onCreate: () => void,
): JSX.Element {
  const createState = deriveCreateState(info)
  const hasVerify = info.methods.length > 0
  return (
    <>
      {createState.kind === 'available' ? (
        <div className="wk-bind-method-list">
          <Button
            theme="solid"
            type="primary"
            block
            size="large"
            disabled={busy}
            onClick={onCreate}
          >
            {t('bind.createAccount')}
          </Button>
        </div>
      ) : null}

      {createState.kind === 'blocked' ? (
        <div className="wk-bind-error" data-severity="soft">
          {createState.reason}
        </div>
      ) : null}

      {createState.kind !== 'hidden' && hasVerify ? (
        <div className="wk-bind-divider" role="separator">
          <span>{t('common.or')}</span>
        </div>
      ) : null}

      {hasVerify ? (
        <>
          {createState.kind === 'available' ? (
            <p className="wk-bind-secondary-hint">{secondaryHintFor(info.methods)}</p>
          ) : null}
          <div className="wk-bind-method-list">
            {info.methods.map((m: BindMethod) => (
              <Button
                key={m}
                // create 可用时 verify 降为次要 (light theme), 没 create 时 verify 还是主要.
                theme={createState.kind === 'available' ? 'light' : 'solid'}
                type="primary"
                block
                size="large"
                disabled={busy}
                onClick={() => onSelectMethod(m)}
              >
                {m === 'password' ? t('bind.methodPassword') : t('bind.methodSms')}
              </Button>
            ))}
          </div>
        </>
      ) : null}
    </>
  )
}

const IdentityBlock = ({ info }: { info: BindInfoResp }) => {
  return (
    <div className="wk-bind-identity">
      <div className="wk-bind-identity-row">
        <span className="wk-bind-identity-label">{t('bind.identity.sso')}</span>
        <span>{info.name || '—'}</span>
      </div>
      {info.masked_email ? (
        <div className="wk-bind-identity-row">
          <span className="wk-bind-identity-label">{t('bind.identity.email')}</span>
          <span>{info.masked_email}</span>
        </div>
      ) : null}
      {info.masked_phone ? (
        <div className="wk-bind-identity-row">
          <span className="wk-bind-identity-label">{t('bind.identity.phone')}</span>
          <span>{info.masked_phone}</span>
        </div>
      ) : null}
    </div>
  )
}

export default BindPage
