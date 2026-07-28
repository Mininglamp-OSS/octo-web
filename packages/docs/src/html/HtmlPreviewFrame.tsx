// Shared sandboxed preview. Scripts stay disabled and editable controls are neutralized.

import { useEffect, useRef, useState } from 'react'
import {
  absolutizeDocAssetUrls,
  buildOctoDocUrl,
  injectBaseHref,
  resolveAbsoluteOctoDocBase,
  resolveOctoDocBase,
} from './htmlDocFrameHelpers.ts'
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
  /** Fired once the iframe document has loaded; hands back the live contentDocument (or null). */
  onFrameLoad?: (doc: Document | null, frame: HTMLIFrameElement) => void
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
  onFrameLoad,
  onStateChange,
  frameRef,
}: HtmlPreviewFrameProps) {
  const [state, setState] = useState<PreviewLoadState>({ status: 'loading' })
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const seq = useRef(0)

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
        const next: PreviewLoadState = raw.trim()
          ? {
              status: 'ready',
              // Absolutize known asset attrs, then inject <base> as the catch-all (CSS url()/root
              // resources) — identical to the original HtmlDocView pipeline.
              html: injectBaseHref(absolutizeDocAssetUrls(raw, url), resolveAbsoluteOctoDocBase()),
              raw,
            }
          : { status: 'empty' }
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
    // onStateChange intentionally excluded — parents pass inline callbacks; refetch keys on slug/version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, version])

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
  return (
    <iframe
      ref={iframeRef}
      className={className ?? 'octo-html-doc-frame'}
      // allow-same-origin lets comments read selections; scripts stay disabled.
      sandbox="allow-same-origin"
      title={title}
      srcDoc={state.html}
      onLoad={() => onFrameLoad?.(iframeRef.current?.contentDocument ?? null, iframeRef.current as HTMLIFrameElement)}
    />
  )
}
