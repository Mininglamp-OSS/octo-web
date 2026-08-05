import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, act } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp, type MockApiClient } from '../octoweb/mock.ts'
import { CreatePptModal } from './CreatePptModal.tsx'

// Drive the POST /ppt/docs response through the mock apiClient responder.
function mountApi(
  responder: MockApiClient['responder'],
): ReturnType<typeof createMockWKApp> {
  const wk = createMockWKApp()
  wk.apiClient.responder = responder
  setWKApp(wk)
  return wk
}

const okResponder: MockApiClient['responder'] = (_m, url) => {
  if (url === '/ppt/docs') return { data: { data: { editorUrl: '/ppt/d/new_deck' } }, status: 201 }
  return { data: {}, status: 200 }
}

/** All four template cards, in DOM order. */
function cards(): HTMLElement[] {
  return screen.getAllByRole('radio')
}

describe('CreatePptModal', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      }),
    })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      }),
    })
    mountApi(okResponder)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <CreatePptModal open={false} spaceId="s_1" onClose={() => {}} onCreated={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a native <dialog> with dialog a11y semantics', () => {
    const { container } = render(
      <CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />,
    )
    const dialogEl = container.querySelector('dialog.octo-ppt-create-modal')
    expect(dialogEl?.tagName).toBe('DIALOG')
    const byRole = screen.getByRole('dialog')
    expect(byRole.getAttribute('aria-modal')).toBe('true')
    expect(byRole.getAttribute('aria-labelledby')).toBeTruthy()
  })

  // ── PPT-UI-001: keyboard semantics ───────────────────────────────────────
  it('exposes a radiogroup of four radio cards with blank selected by default', () => {
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    const radios = cards()
    expect(radios).toHaveLength(4)
    // First card = blank, selected by default (aria-checked + roving tabindex 0).
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(radios[0].getAttribute('tabindex')).toBe('0')
    for (const r of radios.slice(1)) {
      expect(r.getAttribute('aria-checked')).toBe('false')
      expect(r.getAttribute('tabindex')).toBe('-1')
    }
  })

  it('focuses the default template card on open (clear keyboard start point)', async () => {
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    await waitFor(() => expect(document.activeElement).toBe(cards()[0]))
  })

  it('arrow keys move selection AND focus across the cards; Space/Enter confirm', () => {
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    const radios = cards()
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' })
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios[1])
    expect(radios[0].getAttribute('aria-checked')).toBe('false')

    // Wrap-around backwards from the first card lands on the last.
    fireEvent.keyDown(radios[1], { key: 'ArrowLeft' })
    expect(radios[0].getAttribute('aria-checked')).toBe('true')

    // Space/Enter confirm the focused card (native button click → onSelect).
    fireEvent.click(radios[2])
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
  })

  it('keeps focus order group → title → Create → Cancel in the DOM', () => {
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    const group = screen.getByRole('radiogroup')
    const titleInput = screen.getByLabelText('docs.ppt.create.titleLabel')
    const create = screen.getByRole('button', { name: 'docs.ppt.create.submit' })
    const cancel = screen.getByRole('button', { name: 'docs.ppt.create.cancel' })
    // DOCUMENT_POSITION_FOLLOWING === 4: b follows a.
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(group, titleInput)).toBe(true)
    expect(follows(titleInput, create)).toBe(true)
    expect(follows(create, cancel)).toBe(true)
  })

  it('closes and restores focus to the trigger on Esc (dialog cancel)', async () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { container, rerender } = render(
      <CreatePptModal open spaceId="s_1" onClose={onClose} onCreated={() => {}} />,
    )
    const dialogEl = container.querySelector('dialog') as HTMLDialogElement
    // Esc on a native <dialog> fires a cancel event, which our handler routes to onClose.
    fireEvent(dialogEl, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)

    // Parent closes the modal → focus is returned to the trigger.
    rerender(<CreatePptModal open={false} spaceId="s_1" onClose={onClose} onCreated={() => {}} />)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
  })

  // ── R2-F1 defect 1: Esc/close restores focus to the trigger AFTER close ───
  // Faithful to the real DOM race: a native <dialog> moves focus to <body> as it
  // unwinds the Esc/close, AFTER any synchronous restore our handler ran. So the
  // restore must happen on a post-close animation frame, not synchronously inside
  // the cancel/keydown handler. These tests mount a real trigger element and assert
  // document.activeElement === trigger AFTER the close + the browser's focus-to-body,
  // which is exactly what the old synchronous-only implementation failed on.
  it('restores focus to the trigger after Esc, surviving the browser moving focus to <body>', async () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { container, rerender } = render(
      <CreatePptModal open spaceId="s_1" onClose={onClose} onCreated={() => {}} />,
    )
    const dialogEl = container.querySelector('dialog') as HTMLDialogElement
    // The open effect moves focus into the dialog (default card).
    await waitFor(() => expect(document.activeElement).toBe(cards()[0]))

    // Esc on a native <dialog> fires a cancel event, which our handler routes to onClose.
    fireEvent(dialogEl, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    // Parent closes the modal in response.
    rerender(<CreatePptModal open={false} spaceId="s_1" onClose={onClose} onCreated={() => {}} />)

    // Reproduce the real-browser race: focus lands on <body> AFTER the close handler ran.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).not.toBe(trigger)

    // The post-close restore must still win and return focus to the trigger.
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
  })

  it('restores focus to the trigger after Cancel is clicked, surviving focus-to-body', async () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { rerender } = render(
      <CreatePptModal open spaceId="s_1" onClose={onClose} onCreated={() => {}} />,
    )
    ;(cards()[0] as HTMLButtonElement).focus()
    expect(document.activeElement).not.toBe(trigger)

    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<CreatePptModal open={false} spaceId="s_1" onClose={onClose} onCreated={() => {}} />)

    // Browser drops focus to <body> as the dialog closes, after our handler ran.
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).not.toBe(trigger)

    await waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
  })

  // ── R2-F1 root cause: restore target must be the PERSISTENT trigger, not a detached opener ──
  // The picker is opened from a caret dropdown MENU ITEM that unmounts the instant it is clicked.
  // document.activeElement at open time is therefore a node that will detach; restoring to it no-ops
  // onto <body> (the observed defect). When a triggerRef pointing at a PERSISTENT element (the caret)
  // is supplied, the modal must restore focus to THAT, ignoring the detached opener.
  it('restores focus to the persistent triggerRef target even when the captured opener has detached (R2-F1)', async () => {
    const persistent = document.createElement('button')
    persistent.textContent = 'caret'
    document.body.appendChild(persistent)
    const triggerRef = { current: persistent as HTMLElement | null }

    // The transient opener (a menu item) had focus when the modal opened.
    const transientOpener = document.createElement('button')
    document.body.appendChild(transientOpener)
    transientOpener.focus()
    expect(document.activeElement).toBe(transientOpener)

    const { rerender } = render(
      <CreatePptModal open spaceId="s_1" triggerRef={triggerRef} onClose={() => {}} onCreated={() => {}} />,
    )
    // The opener detaches while the modal is up (the dropdown menu has closed).
    transientOpener.remove()
    expect(transientOpener.isConnected).toBe(false)

    rerender(
      <CreatePptModal open={false} spaceId="s_1" triggerRef={triggerRef} onClose={() => {}} onCreated={() => {}} />,
    )
    ;(document.activeElement as HTMLElement | null)?.blur()

    // Focus lands on the persistent caret, never on the detached opener or <body>.
    await waitFor(() => expect(document.activeElement).toBe(persistent))
    persistent.remove()
  })

  // Control: with NO triggerRef and the captured opener detached, the old document.activeElement path
  // cannot restore focus — it strands on <body>. This is the R2-F1 defect the triggerRef fix removes.
  it('control: without triggerRef, a detached opener leaves focus on <body> (the R2-F1 defect)', async () => {
    const transientOpener = document.createElement('button')
    document.body.appendChild(transientOpener)
    transientOpener.focus()

    const { rerender } = render(
      <CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />,
    )
    transientOpener.remove()
    rerender(<CreatePptModal open={false} spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    ;(document.activeElement as HTMLElement | null)?.blur()

    // No connected restore target → focus cannot return; it stays on <body>.
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    })
    expect(document.activeElement).toBe(document.body)
  })


  // ── R2-F1 defect 2: Tab focus is trapped inside the dialog ────────────────
  it('traps Tab focus inside the dialog (Tab from the last control wraps to the first)', () => {
    const { container } = render(
      <CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />,
    )
    const dialogEl = container.querySelector('dialog') as HTMLDialogElement
    // Enable Create so all four tab stops (radio → title → Create → Cancel) exist.
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    const selectedRadio = cards()[0] // blank, tabindex 0
    const cancel = screen.getByRole('button', { name: 'docs.ppt.create.cancel' })

    // Tab from the last control (Cancel) wraps forward to the first (selected radio).
    cancel.focus()
    fireEvent.keyDown(dialogEl, { key: 'Tab' })
    expect(document.activeElement).toBe(selectedRadio)

    // Shift+Tab from the first control wraps backward to the last (Cancel).
    selectedRadio.focus()
    fireEvent.keyDown(dialogEl, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
  })

  // ── R2-F1 defect 3: Create disables synchronously on the first click ──────
  // Two clicks dispatched within a single React batch (before `submitting`
  // state flushes) must still fire only ONE request — a synchronous guard, not
  // just the state-derived `disabled` attribute.
  it('sends only ONE request when Create is double-clicked within one batch', () => {
    const wk = mountApi(() => new Promise(() => {})) // never resolves; stays in-flight
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    const create = screen.getByRole('button', {
      name: /docs\.ppt\.create\.(submit|loading)/,
    }) as HTMLButtonElement
    // Both clicks in ONE act() batch → state has not re-rendered between them.
    act(() => {
      create.click()
      create.click()
    })
    expect(wk.apiClient.calls.filter((c) => c.url === '/ppt/docs')).toHaveLength(1)
  })

  // ── PPT-HUMAN-001: create → land on the backend editor route ─────────────
  it('creates the deck and hands the caller the backend editorUrl (no fabricated route)', async () => {
    const wk = mountApi(okResponder)
    const onCreated = vi.fn()
    render(
      <CreatePptModal open spaceId="s_1" folderId="f_1" onClose={() => {}} onCreated={onCreated} />,
    )
    // Pick the "report" template (3rd card) and type a title.
    fireEvent.click(cards()[2])
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Quarterly review' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/ppt/d/new_deck'))
    const call = wk.apiClient.calls.find((c) => c.url === '/ppt/docs')
    expect(call?.body).toEqual({ title: 'Quarterly review', templateId: 'report', folderId: 'f_1' })
    expect(call?.config?.headers?.['Idempotency-Key']).toBeTruthy()
  })

  // ── PPT-HUMAN-002: empty / invalid title, 400 handling ───────────────────
  it('disables Create until a non-empty title is entered', () => {
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    const create = screen.getByRole('button', { name: 'docs.ppt.create.submit' }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: '   ' },
    })
    expect(create.disabled).toBe(true) // whitespace-only is still empty
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    expect(create.disabled).toBe(false)
  })

  it('on 400 shows an inline error, does NOT navigate, and keeps the modal open', async () => {
    mountApi(() => Promise.reject({ response: { status: 400, data: { error: 'VALIDATION_ERROR' } } }))
    const onCreated = vi.fn()
    const onClose = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={onClose} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))

    await waitFor(() => expect(screen.getByText('docs.ppt.create.validationError')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // Modal still mounted + retriable.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'docs.ppt.create.submit' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a non-400 failure shows the generic error and keeps the modal open', async () => {
    mountApi(() => Promise.reject({ response: { status: 500 } }))
    const onCreated = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(screen.getByText('docs.ppt.create.error')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
  })

  // ── Double-submit + idempotency ──────────────────────────────────────────
  it('prevents double-submit: Create shows loading + disabled, and only ONE request is sent', async () => {
    let resolve!: (v: unknown) => void
    const wk = mountApi(
      () => new Promise((r) => { resolve = r as (v: unknown) => void }),
    )
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={() => {}} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    const create = () => screen.getByRole('button', { name: /docs\.ppt\.create\.(submit|loading)/ }) as HTMLButtonElement
    fireEvent.click(create())
    // In-flight: label flips to loading and the button is disabled.
    await waitFor(() => expect(screen.getByText('docs.ppt.create.loading')).toBeTruthy())
    expect(create().disabled).toBe(true)
    // A second click while loading is a no-op.
    fireEvent.click(create())
    fireEvent.click(create())
    expect(wk.apiClient.calls.filter((c) => c.url === '/ppt/docs')).toHaveLength(1)
    await act(async () => {
      resolve({ data: { data: { editorUrl: '/ppt/d/x' } }, status: 201 })
    })
  })

  it('retry after a failure reuses the SAME idempotency key (no duplicate deck)', async () => {
    let attempt = 0
    const wk = mountApi(() => {
      attempt += 1
      if (attempt === 1) return Promise.reject({ response: { status: 500 } })
      return { data: { data: { editorUrl: '/ppt/d/deck' } }, status: 201 }
    })
    const onCreated = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(screen.getByText('docs.ppt.create.error')).toBeTruthy())
    // Retry the same submit.
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/ppt/d/deck'))

    const keys = wk.apiClient.calls
      .filter((c) => c.url === '/ppt/docs')
      .map((c) => c.config?.headers?.['Idempotency-Key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toBeTruthy()
  })

  // P1-2: a CONTENT-CHANGED resubmit must mint a FRESH idempotency key. Reusing the open-time key
  // across a title change lets the backend dedup the second submit and return the first (stale-title)
  // deck — the user changed the title but gets the old-title deck.
  it('re-mints the idempotency key when the title changes between submits (no stale-title dedup)', async () => {
    let attempt = 0
    const wk = mountApi(() => {
      attempt += 1
      if (attempt === 1) return Promise.reject({ response: { status: 500 } })
      return { data: { data: { editorUrl: '/ppt/d/deck' } }, status: 201 }
    })
    const onCreated = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)

    const titleInput = screen.getByLabelText('docs.ppt.create.titleLabel')
    fireEvent.change(titleInput, { target: { value: 'AAA' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(screen.getByText('docs.ppt.create.error')).toBeTruthy())

    // The user edits the title, then resubmits — this is NOT an identical retry.
    fireEvent.change(titleInput, { target: { value: 'BBB' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/ppt/d/deck'))

    const calls = wk.apiClient.calls.filter((c) => c.url === '/ppt/docs')
    expect(calls).toHaveLength(2)
    expect(calls[0].body).toMatchObject({ title: 'AAA' })
    expect(calls[1].body).toMatchObject({ title: 'BBB' })
    const keys = calls.map((c) => c.config?.headers?.['Idempotency-Key'])
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBeTruthy()
    // Content changed → the second submit must carry a DIFFERENT key.
    expect(keys[0]).not.toBe(keys[1])
  })

  // P2-3: a WHITESPACE-ONLY title edit is NOT a content change — the body carries `title.trim()`, so
  // "AAA" and "AAA " POST byte-identical payloads. The idempotency key must therefore stay STABLE
  // across such an edit; re-minting it (the bug: the effect keyed on the raw title) would let the
  // backend treat the second submit as a distinct create and, if the first actually succeeded
  // server-side, mint a duplicate deck. Keying the effect on the trimmed title fixes it.
  it('does NOT re-mint the idempotency key when only trailing whitespace is added to the title (same trimmed payload)', async () => {
    let attempt = 0
    const wk = mountApi(() => {
      attempt += 1
      if (attempt === 1) return Promise.reject({ response: { status: 500 } })
      return { data: { data: { editorUrl: '/ppt/d/deck' } }, status: 201 }
    })
    const onCreated = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)

    const titleInput = screen.getByLabelText('docs.ppt.create.titleLabel')
    fireEvent.change(titleInput, { target: { value: 'AAA' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(screen.getByText('docs.ppt.create.error')).toBeTruthy())

    // Add a trailing space — the trimmed payload is unchanged, so this is an identical retry.
    fireEvent.change(titleInput, { target: { value: 'AAA ' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('/ppt/d/deck'))

    const calls = wk.apiClient.calls.filter((c) => c.url === '/ppt/docs')
    expect(calls).toHaveLength(2)
    // Both bodies carry the trimmed title, so they are byte-identical…
    expect(calls[0].body).toMatchObject({ title: 'AAA' })
    expect(calls[1].body).toMatchObject({ title: 'AAA' })
    // …and MUST reuse the same key so the backend dedups instead of minting a duplicate deck.
    const keys = calls.map((c) => c.config?.headers?.['Idempotency-Key'])
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
  })

  // P2-1: a NON-retriable failure (the caller refused the backend route, onCreated → false) must show
  // its own message and DISABLE Create — retrying reuses the same key and re-dedups to the same dead
  // route. Editing the payload mints a fresh key and re-enables Create.
  it('P2-1: on a refused (unsafe) route shows the non-retriable message + disables Create, re-enabled after a payload edit', async () => {
    mountApi(okResponder)
    // onCreated returns false → the caller refused to navigate (unsafe/cross-origin route).
    const onCreated = vi.fn(() => false as const)
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)

    const titleInput = screen.getByLabelText('docs.ppt.create.titleLabel')
    fireEvent.change(titleInput, { target: { value: 'Deck' } })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))

    await waitFor(() => expect(screen.getByText('docs.ppt.create.unavailable')).toBeTruthy())
    const submit = () => screen.getByRole('button', { name: 'docs.ppt.create.submit' }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)

    // A genuine payload edit mints a fresh key → distinct create → Create is usable again.
    fireEvent.change(titleInput, { target: { value: 'Deck v2' } })
    expect(submit().disabled).toBe(false)
    expect(screen.queryByText('docs.ppt.create.unavailable')).toBeNull()
  })

  // P2-1: a 201 with no editorUrl (MissingEditorUrlError) is likewise non-retriable — same distinct
  // message + disabled Create, never the generic retriable error.
  it('P2-1: a 201 with no editorUrl shows the non-retriable message + disables Create', async () => {
    mountApi((_m, url) => {
      if (url === '/ppt/docs') return { data: { data: {} }, status: 201 } // no editorUrl
      return { data: {}, status: 200 }
    })
    const onCreated = vi.fn()
    render(<CreatePptModal open spaceId="s_1" onClose={() => {}} onCreated={onCreated} />)
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))

    await waitFor(() => expect(screen.getByText('docs.ppt.create.unavailable')).toBeTruthy())
    expect(onCreated).not.toHaveBeenCalled()
    expect(
      (screen.getByRole('button', { name: 'docs.ppt.create.submit' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  // P1-3 (fix #5): if the user switches space while a create is in flight, the late-resolving
  // space-A create must NOT navigate — it would drop the user into the wrong-space deck. A
  // generation token captured at submit start is invalidated by the open/space-change bump, so the
  // post-await handoff is skipped.
  //
  // This drives the REAL app transition, not the earlier open-held rerender. In DocsHome the
  // Space-switch reconciler (onSpaceChanged → setSpace(next) + backToList()) flips BOTH props in ONE
  // React batch: `open` → false AND `spaceId` → the new id. `spaceId` never changes while `open`
  // stays true — the picker is always closed in the same batch. The prior test held `open` true
  // (`rerender(<CreatePptModal open spaceId="s_B" />)`), a state that cannot occur in the app, so it
  // passed even while the generation bump lived inside the reset effect that early-returns on
  // `!open` (the shipped bug). Bumping the token in its own open-guard-free effect is what makes the
  // real close+space-change transition invalidate the in-flight submit.
  it('does NOT navigate when a space switch closes the picker mid-submit (open→false AND spaceId→new in one update)', async () => {
    let resolve!: (v: unknown) => void
    mountApi(() => new Promise((r) => { resolve = r as (v: unknown) => void }))
    const onCreated = vi.fn()
    const { rerender } = render(
      <CreatePptModal open spaceId="s_A" onClose={() => {}} onCreated={onCreated} />,
    )
    fireEvent.change(screen.getByLabelText('docs.ppt.create.titleLabel'), {
      target: { value: 'Deck A' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'docs.ppt.create.submit' }))
    await waitFor(() => expect(screen.getByText('docs.ppt.create.loading')).toBeTruthy())

    // The Space switch closes the picker (open→false) AND moves to space B in the SAME update — the
    // exact DocsHome batch. The picker is never left open across a spaceId change.
    rerender(<CreatePptModal open={false} spaceId="s_B" onClose={() => {}} onCreated={onCreated} />)

    // The space-A create finally resolves — but its generation is stale now, so no handoff/navigation
    // into the previous space's deck.
    await act(async () => {
      resolve({ data: { data: { editorUrl: '/ppt/d/deck_A' } }, status: 201 })
    })
    expect(onCreated).not.toHaveBeenCalled()
  })
})
