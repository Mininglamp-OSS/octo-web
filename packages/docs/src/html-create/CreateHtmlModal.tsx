import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../octoweb/index.ts'
import {
  buildModifyHtmlPrompt,
  createBlankHtml,
  createUnpredictableSlug,
  persistModifyHtmlPrompt,
  type BlankHtmlResult,
} from './HtmlCreateService.ts'

export interface CreateHtmlModalProps {
  open: boolean
  spaceId: string
  onClose(): void
  onCreated(result: Extract<BlankHtmlResult, { kind: 'published' }>): void
}

export function CreateHtmlModal({ open, spaceId, onClose, onCreated }: CreateHtmlModalProps) {
  const [name, setName] = useState('')
  const [requirements, setRequirements] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<'publish' | 'registration' | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const requestRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const titleId = useId()
  const nameId = useId()
  const requirementsId = useId()

  useEffect(() => {
    requestRef.current.generation += 1
    requestRef.current.controller?.abort()
    requestRef.current.controller = null
    if (open) {
      setName('')
      setRequirements('')
      setSlug(createUnpredictableSlug())
      setLoading(false)
      setError(null)
    }
    return () => {
      requestRef.current.generation += 1
      requestRef.current.controller?.abort()
      requestRef.current.controller = null
    }
  }, [open, spaceId])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    if (!dialog.open) dialog.showModal?.()
    return () => { if (dialog.open) dialog.close?.() }
  }, [open])

  const canSubmit = !!spaceId && !!name.trim() && !!requirements.trim() && !loading && error !== 'registration'

  const submit = async () => {
    if (!canSubmit) return
    const controller = new AbortController()
    requestRef.current.controller?.abort()
    const generation = ++requestRef.current.generation
    requestRef.current.controller = controller
    setLoading(true)
    setError(null)
    try {
      const result = await createBlankHtml({ name, requirements, spaceId, slug, signal: controller.signal })
      if (requestRef.current.generation !== generation || controller.signal.aborted) return
      if (result.kind === 'registration_failed') {
        setError('registration')
        return
      }
      persistModifyHtmlPrompt(
        spaceId,
        result.docId,
        buildModifyHtmlPrompt({ docId: result.docId, name, requirements, slug: result.slug }),
      )
      onCreated(result)
    } catch {
      if (requestRef.current.generation !== generation || controller.signal.aborted) return
      setError('publish')
    } finally {
      if (requestRef.current.generation === generation) {
        requestRef.current.controller = null
        setLoading(false)
      }
    }
  }

  if (!open) return null
  return (
    <div className="octo-html-create-overlay" role="presentation" onMouseDown={loading ? undefined : onClose} data-screen-label="docs-create-html">
      <dialog
        ref={dialogRef}
        className="octo-html-create-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        onCancel={(event) => { event.preventDefault(); if (!loading) onClose() }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="octo-html-create-header">
          <h3 id={titleId} className="octo-html-create-title">{t('docs.list.htmlCreate.title')}</h3>
        </header>
        <form className="octo-html-create-body" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="octo-html-create-field">
            <label className="octo-html-create-label" htmlFor={nameId}>{t('docs.list.htmlCreate.nameLabel')}</label>
            <input id={nameId} className="octo-html-create-textarea" value={name} disabled={loading || error === 'registration'} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="octo-html-create-field">
            <label className="octo-html-create-label" htmlFor={requirementsId}>{t('docs.list.htmlCreate.requirementsLabel')}</label>
            <textarea id={requirementsId} className="octo-html-create-textarea" rows={5} value={requirements} disabled={loading || error === 'registration'} onChange={(event) => setRequirements(event.target.value)} placeholder={t('docs.list.htmlCreate.requirementsPlaceholder')} />
          </div>
          {error && <p role="alert" className="octo-html-create-error">{t(error === 'registration' ? 'docs.list.htmlCreate.registrationFailed' : 'docs.list.htmlCreate.publishFailed')}</p>}
          <footer className="octo-html-create-footer">
            <div className="octo-html-create-footer-actions">
              <button type="button" className="octo-tb-btn" disabled={loading} onClick={onClose}>{t('docs.list.htmlCreate.cancel')}</button>
              <button type="submit" className="octo-tb-btn octo-html-create-submit" disabled={!canSubmit}>{t(loading ? 'docs.list.htmlCreate.creating' : 'docs.list.htmlCreate.create')}</button>
            </div>
          </footer>
        </form>
      </dialog>
    </div>
  )
}
