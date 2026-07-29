// Create-HTML dialog (plan Task 3 / §1.2).
//
// A self-contained, semantic modal: real <dialog>-style role, real <form>, real <textarea>,
// real radio <input>s for bot choice, and a real multiple <input type="file">. It ONLY collects a
// draft and hands it to onSubmit — it never uploads a file and never touches a Bot Token (plan
// §5.3 / §5.5). Attachments are staged as File[] and validated for real only later by
// Conversation.addPendingAttachments (the single source of truth), so here we do lightweight UX
// checks only (description required + length cap, a bot selected).
//
// States (plan §1.2): loading bots / load error + retry / no owned bot / ready. Submit is disabled
// until a bot is chosen and a non-empty, within-cap description exists.

import { useEffect, useId, useRef, useState } from 'react'
import { fetchOwnedBots, MAX_MESSAGE_LENGTH, t, type OwnedBotLite } from '../octoweb/index.ts'
import { buildHtmlCreationMessage, HTML_DESCRIPTION_MAX, type HtmlCreationDraft } from './createHtmlTask.ts'

/** Small line-drawn close glyph for the per-file remove control (UI-SPEC: no unicode/emoji icons). */
function CloseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function PaperclipIcon(): React.ReactElement {
  return (
    <svg className="octo-html-create-add-files-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5.25 8.75l4.4-4.4a2.12 2.12 0 013 3l-5.3 5.3a3.12 3.12 0 01-4.42-4.42l5.13-5.12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export interface CreateHtmlModalProps {
  open: boolean
  spaceId: string
  publishBaseUrl?: string
  onClose(): void
  /** Receives the collected draft (requestId/baseUrl filled by the caller). NOT called on cancel. */
  onSubmit(draft: Omit<HtmlCreationDraft, 'requestId' | 'baseUrl'>): void
}

type BotsState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; bots: OwnedBotLite[] }

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function CreateHtmlModal({ open, spaceId, publishBaseUrl = '', onClose, onSubmit }: CreateHtmlModalProps) {
  const [bots, setBots] = useState<BotsState>({ kind: 'loading' })
  const [selectedBot, setSelectedBot] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<'edit' | 'preview'>('edit')
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  // Bumped to retry only the bot request; form state is preserved.
  const [reloadKey, setReloadKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()
  const descErrId = useId()

  // Opening or changing Space resets the draft; a bot-load retry preserves user input and files.
  useEffect(() => {
    if (!open) return
    setSelectedBot(null)
    setDescription('')
    setFiles([])
    setPhase('edit')
    setCopyNotice(null)
  }, [open, spaceId])

  useEffect(() => {
    if (!open) return
    let active = true
    setBots({ kind: 'loading' })
    setSelectedBot(null)
    if (!spaceId) {
      setBots({ kind: 'ready', bots: [] })
      return
    }
    void fetchOwnedBots(spaceId)
      .then((list) => {
        if (!active) return
        setBots({ kind: 'ready', bots: list })
        setSelectedBot(list.length > 0 ? list[0].uid : null)
      })
      .catch(() => {
        if (active) setBots({ kind: 'error' })
      })
    return () => { active = false }
  }, [open, spaceId, reloadKey])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (!dialog.open) return
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open])



  if (!open) return null

  const trimmed = description.trim()
  const tooLong = description.length > HTML_DESCRIPTION_MAX
  const candidateMessage = buildHtmlCreationMessage({
    requestId: '', botUid: selectedBot ?? '', botName: '', description, files: [], spaceId, baseUrl: publishBaseUrl,
  })
  const messageTooLong = trimmed.length > 0 && candidateMessage.length > MAX_MESSAGE_LENGTH
  const ready = bots.kind === 'ready'
  const hasBots = ready && bots.bots.length > 0
  const canSubmit = hasBots && !!selectedBot && trimmed.length > 0 && !tooLong && !messageTooLong

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : []
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
    // Allow re-picking the same file after removing it.
    e.currentTarget.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const currentDraft = () => {
    if (!canSubmit || !selectedBot) return
    const bot = ready ? bots.bots.find((b) => b.uid === selectedBot) : undefined
    return {
      botUid: selectedBot,
      botName: bot?.name || selectedBot,
      description,
      files,
      spaceId,
    }
  }

  const previewDraft = currentDraft()
  const prompt = previewDraft
    ? buildHtmlCreationMessage({ ...previewDraft, requestId: '', baseUrl: publishBaseUrl })
    : ''

  const copyPrompt = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt)
      } else {
        const copyArea = document.createElement('textarea')
        copyArea.value = prompt
        copyArea.setAttribute('readonly', '')
        copyArea.style.position = 'fixed'
        copyArea.style.opacity = '0'
        document.body.appendChild(copyArea)
        copyArea.select()
        const copied = document.execCommand?.('copy') ?? false
        copyArea.remove()
        if (!copied) throw new Error('copy unavailable')
      }
      setCopyNotice(t(files.length ? 'docs.list.htmlCreate.copySuccessWithFiles' : 'docs.list.htmlCreate.copySuccess'))
    } catch {
      setCopyNotice(t('docs.list.htmlCreate.copyFailed'))
    }
  }

  return (
    <div
      className="octo-html-create-overlay"
      role="presentation"
      onMouseDown={onClose}
      data-screen-label="docs-create-html"
    >
      <dialog
        ref={dialogRef}
        className="octo-html-create-modal"
        aria-modal="true"
        aria-labelledby={titleId}
        onCancel={(e) => { e.preventDefault(); onClose() }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="octo-html-create-header">
          <h3 id={titleId} className="octo-html-create-title">
            {t('docs.list.htmlCreate.title')}
          </h3>
        </header>

        <form
          className="octo-html-create-body"
          onSubmit={(e) => {
            e.preventDefault()
            if (phase === 'edit' && canSubmit) setPhase('preview')
          }}
        >
          {phase === 'preview' ? (
            <>
              <div className="octo-html-create-field">
                <label className="octo-html-create-label" htmlFor={descId}>
                  {t('docs.list.htmlCreate.promptLabel')}
                </label>
                <textarea
                  id={descId}
                  className="octo-html-create-textarea octo-html-create-preview"
                  value={prompt}
                  readOnly
                  rows={16}
                />
                {files.length > 0 && (
                  <p className="octo-html-create-hint">{t('docs.list.htmlCreate.previewFilesHint')}</p>
                )}
                {copyNotice && <p className="octo-html-create-hint" role="status">{copyNotice}</p>}
              </div>
              <footer className="octo-html-create-footer">
                <div className="octo-html-create-footer-actions">
                  <button type="button" className="octo-tb-btn" onClick={() => { setCopyNotice(null); setPhase('edit') }}>
                    {t('docs.list.htmlCreate.backToEdit')}
                  </button>
                  <button type="button" className="octo-tb-btn" onClick={() => void copyPrompt()}>
                    {t('docs.list.htmlCreate.copyPrompt')}
                  </button>
                  <button
                    type="button"
                    className="octo-tb-btn octo-html-create-submit"
                    onClick={() => { const draft = currentDraft(); if (draft) onSubmit(draft) }}
                  >
                    {t('docs.list.htmlCreate.forwardToBot')}
                  </button>
                </div>
                <p className="octo-html-create-prerequisite-hint">{t('docs.list.htmlCreate.prerequisiteHint')}</p>
              </footer>
            </>
          ) : (
            <>
          {/* Description */}
          <div className="octo-html-create-field">
            <label className="octo-html-create-label" htmlFor={descId}>
              {t('docs.list.htmlCreate.descLabel')}
            </label>
            <textarea
              id={descId}
              className="octo-html-create-textarea"
              value={description}
              maxLength={HTML_DESCRIPTION_MAX + 1}
              rows={5}
              placeholder={t('docs.list.htmlCreate.descPlaceholder')}
              aria-describedby={tooLong || messageTooLong ? descErrId : undefined}
              aria-invalid={tooLong || messageTooLong || undefined}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="octo-html-create-counter">
              {description.length}/{HTML_DESCRIPTION_MAX}
            </div>
            {(tooLong || messageTooLong) && (
              <p id={descErrId} className="octo-html-create-error" role="alert">
                {t(tooLong ? 'docs.list.htmlCreate.descTooLong' : 'docs.list.htmlCreate.messageTooLong', {
                  values: { max: MAX_MESSAGE_LENGTH },
                })}
              </p>
            )}
          </div>

          {/* Bot selection */}
          <div className="octo-html-create-field">
            <span className="octo-html-create-label">{t('docs.list.htmlCreate.botLabel')}</span>
            {bots.kind === 'loading' && (
              <p className="octo-html-create-hint">{t('docs.list.htmlCreate.botLoading')}</p>
            )}
            {bots.kind === 'error' && (
              <div className="octo-html-create-inline-error" role="alert">
                <span>{t('docs.list.htmlCreate.botError')}</span>
                <button
                  type="button"
                  className="octo-tb-btn"
                  onClick={() => setReloadKey((n) => n + 1)}
                >
                  {t('docs.list.htmlCreate.retry')}
                </button>
              </div>
            )}
            {ready && !hasBots && (
              <p className="octo-html-create-hint" role="note">
                {t('docs.list.htmlCreate.botEmpty')}
              </p>
            )}
            {hasBots && (
              <ul className="octo-html-create-bot-list">
                {bots.bots.map((b) => (
                  <li key={b.uid}>
                    <label className="octo-html-create-bot-item">
                      <input
                        type="radio"
                        name="octo-html-create-bot"
                        value={b.uid}
                        checked={selectedBot === b.uid}
                        onChange={() => setSelectedBot(b.uid)}
                      />
                      <span className="octo-html-create-bot-text">
                        <span className="octo-html-create-bot-name">{b.name}</span>
                        {b.description && (
                          <span className="octo-html-create-bot-desc">{b.description}</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Reference files (staged only) */}
          <div className="octo-html-create-field">
            <span className="octo-html-create-label">{t('docs.list.htmlCreate.filesLabel')}</span>
            <button
              type="button"
              className="octo-tb-btn octo-html-create-add-files"
              onClick={() => fileInputRef.current?.click()}
            >
              <PaperclipIcon />
              {t('docs.list.htmlCreate.addFiles')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={onPickFiles}
            />
            {files.length > 0 && (
              <ul className="octo-html-create-file-list">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="octo-html-create-file-item">
                    <span className="octo-html-create-file-name">{f.name}</span>
                    <span className="octo-html-create-file-size">{humanSize(f.size)}</span>
                    <button
                      type="button"
                      className="octo-html-create-file-remove"
                      aria-label={t('docs.list.htmlCreate.removeFile')}
                      onClick={() => removeFile(i)}
                    >
                      <CloseIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <footer className="octo-html-create-footer">
            <div className="octo-html-create-footer-actions">
              <button type="button" className="octo-tb-btn" onClick={onClose}>
                {t('docs.list.htmlCreate.cancel')}
              </button>
              <button
                type="submit"
                className="octo-tb-btn octo-html-create-submit"
                disabled={!canSubmit}
              >
                {t('docs.list.htmlCreate.generatePrompt')}
              </button>
            </div>
            <p className="octo-html-create-prerequisite-hint">{t('docs.list.htmlCreate.prerequisiteHint')}</p>
          </footer>
            </>
          )}
        </form>
      </dialog>
    </div>
  )
}
