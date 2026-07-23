import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import { CreateHtmlModal } from './CreateHtmlModal.tsx'

// The modal loads owned bots on open (plan §1.2). Tests inject the seam via setWKApp() and drive
// the /robot/owned_bots response through the mock apiClient responder.
function mountBots(list: Array<{ uid: string; name: string; description?: string }> | 'error') {
  const wk = createMockWKApp()
  wk.apiClient.responder = (_m, url) => {
    if (url.startsWith('/robot/owned_bots')) {
      if (list === 'error') return Promise.reject({ response: { status: 500 } })
      return { data: list, status: 200 }
    }
    return { data: {}, status: 200 }
  }
  setWKApp(wk)
  return wk
}

describe('CreateHtmlModal', () => {
  beforeEach(() => {
    // Default: two owned bots.
    mountBots([
      { uid: 'bot1', name: 'Publisher', description: 'Builds HTML' },
      { uid: 'bot2', name: 'Scribe' },
    ])
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders nothing when closed', () => {
    const { container } = render(
      <CreateHtmlModal open={false} spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders a native <dialog> element (real dialog semantics, not a div impostor)', async () => {
    const { container } = render(
      <CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    // The modal is a real <dialog> element ...
    const dialogEl = container.querySelector('dialog.octo-html-create-modal')
    expect(dialogEl).not.toBeNull()
    expect(dialogEl?.tagName).toBe('DIALOG')
    // ... whose implicit ARIA role is still dialog (queryable by role), with the a11y contract kept.
    const byRole = screen.getByRole('dialog')
    expect(byRole.tagName).toBe('DIALOG')
    expect(byRole.getAttribute('aria-modal')).toBe('true')
    expect(byRole.getAttribute('aria-labelledby')).toBeTruthy()
    // No div is impersonating the dialog role anymore.
    expect(container.querySelector('div[role="dialog"]')).toBeNull()
  })

  it('loads owned bots for the current space on open', async () => {
    const wk = mountBots([{ uid: 'bot1', name: 'Publisher' }])
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    const calls = wk.apiClient.calls.filter((c) => c.url.startsWith('/robot/owned_bots'))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/robot/owned_bots?space_id=s_1')
  })

  it('shows a loading hint before bots resolve', () => {
    // Never-resolving responder keeps it in the loading state.
    const wk = createMockWKApp()
    wk.apiClient.responder = () => new Promise(() => {})
    setWKApp(wk)
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    expect(screen.getByText('docs.list.htmlCreate.botLoading')).toBeTruthy()
  })

  it('shows an error + retry when the bot load fails, and retry refetches', async () => {
    const wk = mountBots('error')
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.botError')).toBeTruthy())
    // Flip the responder to success, then retry.
    wk.apiClient.responder = (_m, url) =>
      url.startsWith('/robot/owned_bots')
        ? { data: [{ uid: 'bot1', name: 'Recovered' }], status: 200 }
        : { data: {}, status: 200 }
    fireEvent.click(screen.getByText('docs.list.htmlCreate.retry'))
    await waitFor(() => expect(screen.getByText('Recovered')).toBeTruthy())
  })

  it('shows the empty state and disables submit when the user owns no bot', async () => {
    mountBots([])
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('docs.list.htmlCreate.botEmpty')).toBeTruthy())
    const submit = screen.getByText('docs.list.htmlCreate.submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
  })

  it('disables submit until a description is entered (bot is preselected)', async () => {
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    const submit = screen.getByText('docs.list.htmlCreate.submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), {
      target: { value: 'A landing page' },
    })
    expect(submit.disabled).toBe(false)
  })

  it('disables submit for a whitespace-only description', async () => {
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), {
      target: { value: '   \n  ' },
    })
    expect((screen.getByText('docs.list.htmlCreate.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('blocks submit and flags an error when the description exceeds 8000 chars', async () => {
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), {
      target: { value: 'x'.repeat(8001) },
    })
    expect(screen.getByText('docs.list.htmlCreate.descTooLong')).toBeTruthy()
    expect((screen.getByText('docs.list.htmlCreate.submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hands the selected bot + description + staged files to onSubmit and never uploads', async () => {
    const wk = mountBots([
      { uid: 'bot1', name: 'Publisher' },
      { uid: 'bot2', name: 'Scribe' },
    ])
    const onSubmit = vi.fn()
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={onSubmit} />)
    await waitFor(() => expect(screen.getByText('Scribe')).toBeTruthy())
    // Choose the second bot.
    fireEvent.click(screen.getByDisplayValue('bot2'))
    fireEvent.change(screen.getByLabelText('docs.list.htmlCreate.descLabel'), {
      target: { value: 'My page' },
    })
    // Stage two files via the hidden file input.
    const f1 = new File(['a'], 'a.png', { type: 'image/png' })
    const f2 = new File(['b'], 'b.pdf', { type: 'application/pdf' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [f1, f2] } })
    fireEvent.click(screen.getByText('docs.list.htmlCreate.submit'))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const draft = onSubmit.mock.calls[0][0]
    expect(draft.botUid).toBe('bot2')
    expect(draft.botName).toBe('Scribe')
    expect(draft.description).toBe('My page')
    expect(draft.files).toHaveLength(2)
    expect(draft.spaceId).toBe('s_1')
    // No upload API touched — only the owned_bots GET.
    const uploads = wk.apiClient.calls.filter((c) => c.method !== 'get')
    expect(uploads).toHaveLength(0)
  })

  it('lets the user remove a staged file before submit', async () => {
    render(<CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    const f1 = new File(['a'], 'keep.png', { type: 'image/png' })
    const f2 = new File(['b'], 'drop.png', { type: 'image/png' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [f1, f2] } })
    expect(screen.getByText('drop.png')).toBeTruthy()
    // Remove the second file.
    const removeBtns = screen.getAllByLabelText('docs.list.htmlCreate.removeFile')
    fireEvent.click(removeBtns[1])
    expect(screen.queryByText('drop.png')).toBeNull()
    expect(screen.getByText('keep.png')).toBeTruthy()
  })

  it('reloads bots when the space changes (no stale bot carried over)', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = (_m, url) => {
      if (url === '/robot/owned_bots?space_id=s_1') return { data: [{ uid: 'a', name: 'AlphaBot' }], status: 200 }
      if (url === '/robot/owned_bots?space_id=s_2') return { data: [{ uid: 'b', name: 'BetaBot' }], status: 200 }
      return { data: {}, status: 200 }
    }
    setWKApp(wk)
    const { rerender } = render(
      <CreateHtmlModal open spaceId="s_1" onClose={() => {}} onSubmit={() => {}} />,
    )
    await waitFor(() => expect(screen.getByText('AlphaBot')).toBeTruthy())
    rerender(<CreateHtmlModal open spaceId="s_2" onClose={() => {}} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('BetaBot')).toBeTruthy())
    expect(screen.queryByText('AlphaBot')).toBeNull()
  })

  it('closes on Escape and on cancel', async () => {
    const onClose = vi.fn()
    render(<CreateHtmlModal open spaceId="s_1" onClose={onClose} onSubmit={() => {}} />)
    await waitFor(() => expect(screen.getByText('Publisher')).toBeTruthy())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('docs.list.htmlCreate.cancel'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
