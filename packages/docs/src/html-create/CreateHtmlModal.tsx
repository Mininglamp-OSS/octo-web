import { useEffect, useId, useRef, useState } from 'react'
import { fetchOwnedBots, MAX_MESSAGE_LENGTH, t, type OwnedBotLite } from '../octoweb/index.ts'
import { buildHtmlCreationMessage, HTML_DESCRIPTION_MAX, type HtmlCreationDraft } from './createHtmlTask.ts'
import { buildModifyHtmlPrompt, createBlankHtml, createUnpredictableSlug, HtmlPublishError, type BlankHtmlResult } from './HtmlCreateService.ts'

export interface CreateHtmlModalProps {
  open: boolean
  spaceId: string
  publishBaseUrl?: string
  onClose(): void
  onCreated(result: Extract<BlankHtmlResult, { kind: 'published' }>): void
  onSubmit?(draft: Omit<HtmlCreationDraft, 'requestId' | 'baseUrl'>): void
}

type BotsState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; bots: OwnedBotLite[] }
type DirectError = 'publish' | 'uncertain' | 'registration' | null

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const area = document.createElement('textarea')
  area.value = value
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  const copied = document.execCommand?.('copy') ?? false
  area.remove()
  if (!copied) throw new Error('copy unavailable')
}

/** Line-drawn close glyph (UI-SPEC: no unicode/emoji functional icons). */
function CloseIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function CreateHtmlModal({ open, spaceId, publishBaseUrl = '', onClose, onCreated, onSubmit }: CreateHtmlModalProps) {
  const [mode, setMode] = useState<'direct' | 'bot'>('direct')
  const [name, setName] = useState('')
  const [requirements, setRequirements] = useState('')
  const [slug, setSlug] = useState('')
  const [loading, setLoading] = useState(false)
  const [directError, setDirectError] = useState<DirectError>(null)
  const [published, setPublished] = useState<Extract<BlankHtmlResult, { kind: 'published' }> | null>(null)
  const [bots, setBots] = useState<BotsState>({ kind: 'loading' })
  const [selectedBot, setSelectedBot] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [botPhase, setBotPhase] = useState<'edit' | 'preview'>('edit')
  const [botSubmitted, setBotSubmitted] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const copyGenerationRef = useRef(0)
  const botSubmittedRef = useRef(false)
  const requestRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const nameId = useId()
  const requirementsId = useId()
  const promptId = useId()
  const descId = useId()
  const descErrId = useId()

  useEffect(() => {
    requestRef.current.generation += 1
    requestRef.current.controller?.abort()
    requestRef.current.controller = null
    if (open) {
      setMode('direct'); setName(''); setRequirements(''); setSlug(createUnpredictableSlug())
      setLoading(false); setDirectError(null); setPublished(null); setDescription(''); setFiles([])
      botSubmittedRef.current = false
      setBotPhase('edit'); setBotSubmitted(false); setCopyNotice(null); setSelectedBot(null)
    }
    return () => { requestRef.current.generation += 1; requestRef.current.controller?.abort() }
  }, [open, spaceId])

  useEffect(() => {
    if (!open || mode !== 'bot') return
    let active = true
    setBots({ kind: 'loading' })
    setSelectedBot(null)
    if (!spaceId) { setBots({ kind: 'ready', bots: [] }); return }
    void fetchOwnedBots(spaceId).then((list) => {
      if (!active) return
      setBots({ kind: 'ready', bots: list })
      setSelectedBot(list[0]?.uid ?? null)
    }).catch(() => { if (active) setBots({ kind: 'error' }) })
    return () => { active = false }
  }, [open, mode, spaceId, reloadKey])

  useEffect(() => {
    copyGenerationRef.current += 1
    setCopyNotice(null)
    botSubmittedRef.current = false
    setBotSubmitted(false)
  }, [mode, description, files, selectedBot])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    if (!dialog.open) dialog.showModal?.()
    return () => { if (dialog.open) dialog.close?.() }
  }, [open])

  if (!open) return null

  const directPrompt = published
    ? buildModifyHtmlPrompt({ docId: published.docId, name, requirements, slug: published.slug })
    : t('docs.list.htmlCreate.precreatePrompt', {
        values: {
          name: name.trim(),
          requirements: requirements.trim() || t('docs.list.htmlCreate.followUpRequirements'),
        },
      })
  const directLocked = directError === 'registration' || directError === 'uncertain'
  const canCreate = !!spaceId && !!name.trim() && !!requirements.trim() && !loading && !directLocked && !published

  const submitDirect = async () => {
    if (!canCreate) return
    const controller = new AbortController()
    requestRef.current.controller?.abort()
    const generation = ++requestRef.current.generation
    requestRef.current.controller = controller
    setLoading(true); setDirectError(null)
    try {
      const result = await createBlankHtml({ name, requirements, spaceId, slug, signal: controller.signal })
      if (requestRef.current.generation !== generation || controller.signal.aborted) return
      if (result.kind === 'registration_failed') { setDirectError('registration'); return }
      setPublished(result)
    } catch (error) {
      if (requestRef.current.generation === generation && !controller.signal.aborted) {
        setDirectError(error instanceof HtmlPublishError && error.outcome === 'not_published' ? 'publish' : 'uncertain')
      }
    } finally {
      if (requestRef.current.generation === generation) { requestRef.current.controller = null; setLoading(false) }
    }
  }

  const trimmed = description.trim()
  const candidate = buildHtmlCreationMessage({ requestId: '', botUid: selectedBot ?? '', botName: '', description, files: [], spaceId, baseUrl: publishBaseUrl })
  const tooLong = description.length > HTML_DESCRIPTION_MAX
  const messageTooLong = !!trimmed && candidate.length > MAX_MESSAGE_LENGTH
  const ready = bots.kind === 'ready'
  const hasBots = ready && bots.bots.length > 0
  const canBotSubmit = hasBots && !!selectedBot && !!trimmed && !tooLong && !messageTooLong
  const botDraft = canBotSubmit && selectedBot ? {
    botUid: selectedBot,
    botName: ready ? bots.bots.find((bot) => bot.uid === selectedBot)?.name || selectedBot : selectedBot,
    description, files, spaceId,
  } : null
  const botPrompt = botDraft ? buildHtmlCreationMessage({ ...botDraft, requestId: '', baseUrl: publishBaseUrl }) : ''
  const copy = async (value: string, withFiles = false) => {
    const generation = copyGenerationRef.current
    try {
      await copyText(value)
      if (generation !== copyGenerationRef.current) return false
      setCopyNotice(t(withFiles ? 'docs.list.htmlCreate.copySuccessWithFiles' : 'docs.list.htmlCreate.copySuccess'))
      return true
    } catch {
      if (generation !== copyGenerationRef.current) return false
      setCopyNotice(t('docs.list.htmlCreate.copyFailed'))
      return false
    }
  }

  return (
    <div className="octo-html-create-overlay" role="presentation" onMouseDown={loading ? undefined : onClose} data-screen-label="docs-create-html">
      <dialog ref={dialogRef} className="octo-html-create-modal" aria-modal="true" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!loading) onClose() }} onMouseDown={(event) => event.stopPropagation()}>
        <header className="octo-html-create-header">
          <h3 id={titleId} className="octo-html-create-title">{t('docs.list.htmlCreate.title')}</h3>
          <button
            type="button"
            className="octo-html-create-close"
            aria-label={t('docs.list.htmlCreate.close')}
            disabled={loading}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="octo-html-create-mode-cards" role="radiogroup" aria-label={t('docs.list.htmlCreate.modeLabel')}>
          {(['direct', 'bot'] as const).map((choice) => (
            <label key={choice} className="octo-html-create-mode-card">
              <input
                className="octo-html-create-mode-input"
                type="radio"
                name="octo-html-create-mode"
                value={choice}
                checked={mode === choice}
                disabled={loading}
                onChange={() => setMode(choice)}
              />
              <span className="octo-html-create-mode-indicator" aria-hidden="true">{mode === choice ? '✓' : ''}</span>
              <span className="octo-html-create-mode-copy">
                <span className="octo-html-create-mode-title">{t(`docs.list.htmlCreate.mode${choice === 'direct' ? 'Direct' : 'Bot'}`)}</span>
                <span className="octo-html-create-mode-description">{t(`docs.list.htmlCreate.mode${choice === 'direct' ? 'Direct' : 'Bot'}Description`)}</span>
              </span>
            </label>
          ))}
        </div>
        {mode === 'direct' ? (
          <form className="octo-html-create-body" onSubmit={(event) => { event.preventDefault(); void submitDirect() }}>
            {published && <p role="status" className="octo-html-create-hint">{t('docs.list.htmlCreate.directSuccess')}</p>}
            {!published && <>
              <div className="octo-html-create-field"><label className="octo-html-create-label" htmlFor={nameId}>{t('docs.list.htmlCreate.nameLabel')}</label><input id={nameId} className="octo-html-create-textarea octo-html-create-input" value={name} disabled={loading || directLocked} onChange={(event) => setName(event.target.value)} /></div>
              <div className="octo-html-create-field"><label className="octo-html-create-label" htmlFor={requirementsId}>{t('docs.list.htmlCreate.requirementsLabel')}</label><textarea id={requirementsId} className="octo-html-create-textarea" rows={5} value={requirements} disabled={loading || directLocked} onChange={(event) => setRequirements(event.target.value)} placeholder={t('docs.list.htmlCreate.requirementsPlaceholder')} /></div>
            </>}
            <div className="octo-html-create-field">
              <label className="octo-html-create-label" htmlFor={promptId}>{t('docs.list.htmlCreate.promptLabel')}</label>
              <p className="octo-html-create-hint">{t('docs.list.htmlCreate.directPromptHelp')}</p>
              <textarea id={promptId} className="octo-html-create-textarea octo-html-create-preview" value={directPrompt} readOnly rows={published ? 8 : 5} />
            </div>
            {copyNotice && <p role="status" className="octo-html-create-hint">{copyNotice}</p>}
            {directError && <p role="alert" className="octo-html-create-error">{t(directError === 'registration' ? 'docs.list.htmlCreate.registrationFailed' : directError === 'uncertain' ? 'docs.list.htmlCreate.publishUncertain' : 'docs.list.htmlCreate.publishFailed')}</p>}
            <footer className="octo-html-create-footer"><div className="octo-html-create-footer-actions">
              <button type="button" className="octo-tb-btn" disabled={loading} onClick={onClose}>{t('docs.list.htmlCreate.cancel')}</button>
              {published ? <>
                <button type="button" className="octo-tb-btn octo-html-create-submit" onClick={() => void copy(directPrompt).then((copied) => { if (copied) onCreated(published) })}>{t('docs.list.htmlCreate.copyPromptAndOpen')}</button>
                <button type="button" className="octo-tb-btn" onClick={() => onCreated(published)}>{t('docs.list.htmlCreate.openDirectly')}</button>
              </> : <button type="submit" className="octo-tb-btn octo-html-create-submit" disabled={!canCreate}>{t(loading ? 'docs.list.htmlCreate.creating' : 'docs.list.htmlCreate.create')}</button>}
            </div></footer>
          </form>
        ) : (
          <form className="octo-html-create-body" onSubmit={(event) => { event.preventDefault(); if (canBotSubmit) { botSubmittedRef.current = false; setBotSubmitted(false); setBotPhase('preview') } }}>
            {botPhase === 'preview' ? <>
              <div className="octo-html-create-field"><label className="octo-html-create-label" htmlFor={descId}>{t('docs.list.htmlCreate.botPromptLabel')}</label><textarea id={descId} className="octo-html-create-textarea octo-html-create-preview" value={botPrompt} readOnly rows={16} />{files.length > 0 && <p className="octo-html-create-hint">{t('docs.list.htmlCreate.previewFilesHint')}</p>}{copyNotice && <p role="status" className="octo-html-create-hint">{copyNotice}</p>}</div>
              <footer className="octo-html-create-footer"><div className="octo-html-create-footer-actions"><button type="button" className="octo-tb-btn" onClick={() => { copyGenerationRef.current += 1; botSubmittedRef.current = false; setBotSubmitted(false); setCopyNotice(null); setBotPhase('edit') }}>{t('docs.list.htmlCreate.backToEdit')}</button><button type="button" className="octo-tb-btn" onClick={() => void copy(botPrompt, files.length > 0)}>{t('docs.list.htmlCreate.copyPrompt')}</button><button type="button" className="octo-tb-btn octo-html-create-submit" disabled={botSubmitted} onClick={() => { if (!botDraft || botSubmittedRef.current) return; botSubmittedRef.current = true; setBotSubmitted(true); onSubmit?.(botDraft) }}>{t('docs.list.htmlCreate.forwardToBot')}</button></div></footer>
            </> : <>
              <div className="octo-html-create-field"><label className="octo-html-create-label" htmlFor={descId}>{t('docs.list.htmlCreate.descLabel')}</label><textarea id={descId} className="octo-html-create-textarea" value={description} maxLength={HTML_DESCRIPTION_MAX + 1} rows={5} placeholder={t('docs.list.htmlCreate.descPlaceholder')} aria-describedby={tooLong || messageTooLong ? descErrId : undefined} aria-invalid={tooLong || messageTooLong || undefined} onChange={(event) => setDescription(event.target.value)} /><div className="octo-html-create-counter">{description.length}/{HTML_DESCRIPTION_MAX}</div>{(tooLong || messageTooLong) && <p id={descErrId} className="octo-html-create-error" role="alert">{t(tooLong ? 'docs.list.htmlCreate.descTooLong' : 'docs.list.htmlCreate.messageTooLong', { values: { max: MAX_MESSAGE_LENGTH } })}</p>}</div>
              <div className="octo-html-create-field"><span className="octo-html-create-label">{t('docs.list.htmlCreate.botLabel')}</span>{bots.kind === 'loading' && <p className="octo-html-create-hint">{t('docs.list.htmlCreate.botLoading')}</p>}{bots.kind === 'error' && <div className="octo-html-create-inline-error" role="alert"><span>{t('docs.list.htmlCreate.botError')}</span><button type="button" className="octo-tb-btn" onClick={() => setReloadKey((value) => value + 1)}>{t('docs.list.htmlCreate.retry')}</button></div>}{ready && !hasBots && <p className="octo-html-create-hint">{t('docs.list.htmlCreate.botEmpty')}</p>}{hasBots && <ul className="octo-html-create-bot-list">{bots.bots.map((bot) => <li key={bot.uid}><label className="octo-html-create-bot-item"><input type="radio" name="octo-html-create-bot" value={bot.uid} checked={selectedBot === bot.uid} onChange={() => setSelectedBot(bot.uid)} /><span className="octo-html-create-bot-text"><span className="octo-html-create-bot-name">{bot.name}</span>{bot.description && <span className="octo-html-create-bot-desc">{bot.description}</span>}</span></label></li>)}</ul>}</div>
              <div className="octo-html-create-field"><span className="octo-html-create-label">{t('docs.list.htmlCreate.filesLabel')}</span><button type="button" className="octo-tb-btn octo-html-create-add-files" onClick={() => fileInputRef.current?.click()}>{t('docs.list.htmlCreate.addFiles')}</button><input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={(event) => { if (event.target.files) setFiles((current) => [...current, ...Array.from(event.target.files!)]); event.currentTarget.value = '' }} />{files.length > 0 && <ul className="octo-html-create-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`} className="octo-html-create-file-item"><span className="octo-html-create-file-name">{file.name}</span><span className="octo-html-create-file-size">{humanSize(file.size)}</span><button type="button" className="octo-html-create-file-remove" aria-label={t('docs.list.htmlCreate.removeFile')} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>×</button></li>)}</ul>}</div>
              <footer className="octo-html-create-footer"><div className="octo-html-create-footer-actions"><button type="button" className="octo-tb-btn" onClick={onClose}>{t('docs.list.htmlCreate.cancel')}</button><button type="submit" className="octo-tb-btn octo-html-create-submit" disabled={!canBotSubmit}>{t('docs.list.htmlCreate.generatePrompt')}</button></div><p className="octo-html-create-prerequisite-hint">{t('docs.list.htmlCreate.prerequisiteHint')}</p></footer>
            </>}
          </form>
        )}
      </dialog>
    </div>
  )
}
