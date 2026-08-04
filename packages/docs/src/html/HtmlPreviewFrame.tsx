// Shared sandboxed preview. Scripts run in an isolated (allow-scripts, NO allow-same-origin)
// sandbox; the parent talks to the frame only through the constrained postMessage bridge
// (htmlDocBridge). The sandbox blocks parent DOM/storage/origin access but NOT outbound network
// from doc JS (an accepted egress capability). Editable controls are still neutralized in the
// markup; referrerPolicy="no-referrer" strips the Referer leak channel.

import { useEffect, useRef, useState } from 'react'
import {
  absolutizeDocAssetUrls,
  buildOctoDocUrl,
  injectBaseHref,
  resolveAbsoluteOctoDocBase,
  resolveOctoDocBase,
} from './htmlDocFrameHelpers.ts'
import { bridgeAvailable, injectBridgeScript, newBridgeToken } from './htmlDocBridge.ts'
import { getWKApp, t } from '../octoweb/index.ts'

export type PreviewLoadState =
  | { status: 'loading' }
  | { status: 'error'; url?: string }
  | { status: 'empty' }
  | { status: 'ready'; html: string; raw: string }

export interface HtmlPreviewFrameProps {
  slug: string
  version: string
  title: string
  className?: string
  /**
   * Isolation mode for the untrusted agent HTML. Two mutually-exclusive, both-safe modes — the
   * dangerous allow-scripts + allow-same-origin combination is NEVER offered:
   *   - 'scripts' (DEFAULT, issue #27): sandbox="allow-scripts", NO allow-same-origin. Doc JS runs
   *     in an opaque origin walled off from the parent; the postMessage bridge is injected and
   *     selection/anchor data crosses the boundary over it. contentDocument is unreadable (null).
   *   - 'readonly-dom': sandbox="allow-same-origin", NO allow-scripts. Scripts never execute, so
   *     the parent may safely read contentDocument directly (used by the static page-diff view,
   *     which mirrors scroll and highlights changes across two panes). No bridge is injected.
   */
  isolation?: 'scripts' | 'readonly-dom'
  /**
   * Fired once the iframe has loaded; hands back the frame. NOTE: in the default 'scripts' mode
   * the contentDocument is a cross-origin, opaque document the parent CANNOT read — selection/
   * anchor data crosses the boundary over the postMessage bridge instead, and `doc` is null. In
   * 'readonly-dom' mode `doc` is the live (script-free) contentDocument.
   */
  onFrameLoad?: (doc: Document | null, frame: HTMLIFrameElement, token: string | null) => void
  /** Fired on every state transition so a parent can read the raw source / react to error. */
  onStateChange?: (state: PreviewLoadState) => void
  /** Test/imperative hook: receive the iframe ref once mounted. */
  frameRef?: (frame: HTMLIFrameElement | null) => void
}

function renderHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'text/html' }
  const tok = getWKApp().loginInfo?.token
  if (tok) headers.token = tok
  return headers
}

export function HtmlPreviewFrame({
  slug,
  version,
  title,
  className,
  isolation = 'scripts',
  onFrameLoad,
  onStateChange,
  frameRef,
}: HtmlPreviewFrameProps) {
  const [state, setState] = useState<PreviewLoadState>({ status: 'loading' })
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const seq = useRef(0)
  // Per-render bridge token embedded in this srcDoc build; handed to the parent on load so it can
  // reject replies from a stale generation. Not a secret (hostile doc JS reads it), just a
  // correlation id — accepted facts stay non-privileged.
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    const mySeq = ++seq.current
    const controller = new AbortController()
    setState({ status: 'loading' })
    onStateChange?.({ status: 'loading' })
    const url = buildOctoDocUrl(slug, version)
    fetch(url, {
      credentials: 'include',
      headers: renderHeaders(),
      cache: version === 'latest' ? 'no-cache' : undefined,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (mySeq !== seq.current) return
        if (!res.ok) {
          const next: PreviewLoadState = { status: 'error', url }
          setState(next)
          onStateChange?.(next)
          return
        }
        const raw = await res.text()
        if (mySeq !== seq.current) return
        // Absolutize asset attrs + inject <base> (CSS url()/root resource catch-all). In 'scripts'
        // isolation append the postMessage bridge; 'readonly-dom' runs no scripts, so it's omitted.
        const prepared = injectBaseHref(absolutizeDocAssetUrls(raw, url), resolveAbsoluteOctoDocBase())
        let html = prepared
        // Only mint/store a token when the bridge can ACTUALLY be injected. injectBridgeScript fails
        // closed (returns HTML unchanged, no bridge) when DOMParser is unavailable (SSR), so gate on
        // bridgeAvailable() to keep tokenRef in lockstep with what's really in the srcDoc.
        if (raw.trim() && isolation === 'scripts' && bridgeAvailable()) {
          const token = newBridgeToken()
          tokenRef.current = token
          html = injectBridgeScript(prepared, token)
        } else {
          tokenRef.current = null
        }
        const next: PreviewLoadState = raw.trim() ? { status: 'ready', html, raw } : { status: 'empty' }
        setState(next)
        onStateChange?.(next)
      })
      .catch((err) => {
        if (mySeq !== seq.current || controller.signal.aborted) return
        console.warn(
          `[HtmlPreviewFrame] octo-doc request failed for ${url}` +
            (resolveOctoDocBase() ? '' : ' — octo-doc base is unconfigured (same-origin default)'),
          err,
        )
        const next: PreviewLoadState = { status: 'error', url }
        setState(next)
        onStateChange?.(next)
      })
    return () => controller.abort()
    // onStateChange intentionally excluded — parents pass inline callbacks; refetch keys on
    // slug/version/isolation (isolation flips bridge injection, so a change must rebuild srcDoc).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, version, isolation])

  useEffect(() => {
    frameRef?.(iframeRef.current)
    return () => frameRef?.(null)
  }, [frameRef])

  if (state.status === 'loading') {
    return (
      <div className="octo-html-doc-state" role="status">
        {t('docs.state.loading')}
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <div className="octo-html-doc-state octo-html-doc-state--error" role="alert">
        {t('docs.state.error')}
        {state.url && <div className="octo-html-doc-state-detail">{state.url}</div>}
      </div>
    )
  }
  if (state.status === 'empty') {
    return <div className="octo-html-doc-state">{t('docs.state.empty')}</div>
  }
  const scriptsMode = isolation === 'scripts'
  return (
    <iframe
      ref={iframeRef}
      className={className ?? 'octo-html-doc-frame'}
      // Two mutually-exclusive, both-safe sandboxes. NEVER combine allow-scripts with
      // allow-same-origin. scripts: doc JS runs in an opaque origin, walled off from the PARENT
      // DOM/storage/origin (issue #27). readonly-dom: no scripts, so parent DOM reads are safe.
      // Outbound network from doc JS is NOT blocked (accepted egress); referrerPolicy caps the
      // Referer leak channel.
      sandbox={scriptsMode ? 'allow-scripts' : 'allow-same-origin'}
      referrerPolicy="no-referrer"
      title={title}
      srcDoc={state.html}
      // In 'scripts' mode contentDocument is cross-origin (opaque) and unreadable — hand back null
      // and let the postMessage bridge carry selection/anchor data. In 'readonly-dom' mode the
      // (script-free) document is safe to read, so pass it through.
      onLoad={() =>
        onFrameLoad?.(
          scriptsMode ? null : iframeRef.current?.contentDocument ?? null,
          iframeRef.current as HTMLIFrameElement,
          scriptsMode ? tokenRef.current : null,
        )
      }
    />
  )
}
