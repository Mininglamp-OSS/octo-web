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
import { fetchOwnedBots, t, type OwnedBotLite } from '../octoweb/index.ts'
import { HTML_DESCRIPTION_MAX, type HtmlCreationDraft } from './createHtmlTask.ts'

/** Small line-drawn close glyph for the per-file remove control (UI-SPEC: no unicode/emoji icons). */
function CloseIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export interface CreateHtmlModalProps {
  open: boolean
  spaceId: string
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

export function CreateHtmlModal({ open, spaceId, onClose, onSubmit }: CreateHtmlModalProps) {
  const [bots, setBots] = useState<BotsState>({ kind: 'loading' })
  const [selectedBot, setSelectedBot] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [files, setFiles] = useState<File[]>([])
  // Bumped to force a reload after "retry"; also the generation guard against a stale response
  // overwriting a newer request when open/spaceId changes mid-flight (plan Task 3 step 3).
  const [reloadKey, setReloadKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const descId = useId()
  const descErrId = useId()

  // Reset the form every time the dialog (re)opens or the Space changes — a stale draft from a
  // previous Space must never carry over (plan §5.7). Guard responses with a generation counter so
  // switching Space while a fetch is in flight can't land the old Space's bots.
  useEffect(() => {
    if (!open) return
    let generation = reloadKey
    let active = true
    setBots({ kind: 'loading' })
    setSelectedBot(null)
    setDescription('')
    setFiles([])
    if (!spaceId) {
      setBots({ kind: 'ready', bots: [] })
      return
    }
    void fetchOwnedBots(spaceId)
      .then((list) => {
        if (!active || generation !== reloadKey) return
        setBots({ kind: 'ready', bots: list })
        // Preselect the first bot so a single-bot user can submit immediately.
        setSelectedBot(list.length > 0 ? list[0].uid : null)
      })
      .catch(() => {
        if (!active || generation !== reloadKey) return
        setBots({ kind: 'error' })
      })
    return () => {
      active = false
      // Advance the guard so a resolve after cleanup is ignored (generation !== reloadKey).
      generation = -1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spaceId, reloadKey])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmed = description.trim()
  const tooLong = description.length > HTML_DESCRIPTION_MAX
  const ready = bots.kind === 'ready'
  const hasBots = ready && bots.bots.length > 0
  const canSubmit = hasBots && !!selectedBot && trimmed.length > 0 && !tooLong

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : []
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked])
    // Allow re-picking the same file after removing it.
    e.currentTarget.value = ''
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const submit = () => {
    if (!canSubmit || !selectedBot) return
    const bot = ready ? bots.bots.find((b) => b.uid === selectedBot) : undefined
    onSubmit({
      botUid: selectedBot,
      botName: bot?.name || selectedBot,
      description,
      files,
      spaceId,
    })
  }

  return (
    <div
      className="octo-html-create-overlay"
      role="presentation"
      onMouseDown={onClose}
      data-screen-label="docs-create-html"
    >
      {/*
        Native <dialog> element for real modal semantics (UI-SPEC: use semantic elements, not a div
        impersonating a dialog via role). We render it with the `open` attribute rather than calling
        showModal() because (a) the backdrop + centering is owned by .octo-html-create-overlay and
        (b) showModal()'s top-layer/::backdrop isn't implemented in jsdom. An open <dialog> already
        exposes the implicit ARIA dialog role, so role=dialog stays queryable. aria-modal +
        aria-labelledby preserve the assistive-tech contract.
      */}
      <dialog
        className="octo-html-create-modal"
        open
        aria-modal="true"
        aria-labelledby={titleId}
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
            submit()
          }}
        >
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
              aria-describedby={tooLong ? descErrId : undefined}
              aria-invalid={tooLong || undefined}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="octo-html-create-counter">
              {description.length}/{HTML_DESCRIPTION_MAX}
            </div>
            {tooLong && (
              <p id={descErrId} className="octo-html-create-error" role="alert">
                {t('docs.list.htmlCreate.descTooLong')}
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
              className="octo-tb-btn"
              onClick={() => fileInputRef.current?.click()}
            >
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
            <button type="button" className="octo-tb-btn" onClick={onClose}>
              {t('docs.list.htmlCreate.cancel')}
            </button>
            <button
              type="submit"
              className="octo-tb-btn octo-html-create-submit"
              disabled={!canSubmit}
            >
              {t('docs.list.htmlCreate.submit')}
            </button>
          </footer>
        </form>
      </dialog>
    </div>
  )
}
