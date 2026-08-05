import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { setWKApp, MAX_MESSAGE_LENGTH } from '../octoweb/index.ts'
import {
  forwardPlainTextCalls,
  setForwardPlainTextImpl,
} from '../__mocks__/octoBase.ts'
import { createMockWKApp } from '../octoweb/mock.ts'

// The guide's two footer actions — 复制提示词 / 转发给 Bot — are the parts with real side effects
// (clipboard write, GET /robot/owned_bots, and a one-shot autoSend into a bot DM). DocGuide.test.tsx
// covers the panel's CONTENT; this file covers that BEHAVIOUR, which otherwise shipped untested.
//
// Only the heavy Conversation is replaced (Channel / ChannelTypePerson / fetchOwnedBots stay real), so
// the mount contract is asserted against the props DocGuide actually passes. Same pattern as
// DocsBotConversation.test.tsx.
let lastConversationProps: {
  channel: { channelID: string; channelType: number }
  initialCompose?: { requestId: string; text: string; files: File[]; autoSend: boolean }
  // Asserted on: the hidden sender must mount as auxiliary so it does not seize the host's
  // openChannel / attachment guard and then clear them on teardown.
  isAuxiliary?: boolean
  onContext?: (ctx: { messageInputContext: () => { restoreDraft: (text: string) => void } }) => void
  onInitialComposeStateChange?: (r: string, s: string, reason?: string) => void
} | null = null
let conversationMounts = 0
// Per-channel draft store standing in for the host's persisted conversation draft (the real
// Conversation writes composer text there in componentWillUnmount -> dealloc ->
// markConversationExtra). The double below mirrors the three host behaviours that together caused
// the reported draft-poisoning bug: initialCompose LOADS text into the composer, a rejected send
// PRESERVES it (MessageInput), and unmount PERSISTS whatever remains as the channel draft.
const persistedDrafts = new Map<string, string>()

vi.mock('../octoweb/index.ts', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  // vi.mock factories are hoisted above the imports, so React has to be pulled in HERE rather than
  // captured from module scope (a top-level import would be undefined at factory run time).
  const { useRef: useRefImpl, useEffect: useEffectImpl } = await import('react')
  return {
    ...actual,
    // The shared stub is `t: (key) => key`, which silently swallows the second argument — so it
    // cannot tell `t(key, { values })` apart from a hand-written `key.replace('{{name}}', n)`.
    // This variant appends the interpolation payload, letting the status-line tests assert that the
    // bot name really travels through the i18n values channel (the project's only supported
    // interpolation path, per DocsHome.tsx's `t('docs.list.updatedBy', { values: { name } })`).
    useI18n: () => ({
      t: (key: string, opts?: { values?: Record<string, unknown> }) =>
        opts?.values ? `${key}|${JSON.stringify(opts.values)}` : key,
      locale: 'en-US' as const,
    }),
    Conversation: (props: NonNullable<typeof lastConversationProps>) => {
      lastConversationProps = props
      conversationMounts += 1
      const channelKey = props.channel.channelID
      // Composer content, seeded by initialCompose exactly like the host does.
      const composer = useRefImpl<string>(props.initialCompose?.text ?? '')
      // The host hands out its context via onContext — the same public seam DocGuide uses. Only
      // messageInputContext().restoreDraft is modelled, since that is all DocGuide may reach for.
      useEffectImpl(() => {
        props.onContext?.({
          messageInputContext: () => ({
            restoreDraft: (text: string) => {
              composer.current = text
            },
          }),
        })
      }, [])
      // Persist-on-unmount, the host's dealloc -> markConversationExtra behaviour.
      useEffectImpl(
        () => () => {
          persistedDrafts.set(channelKey, composer.current)
        },
        [channelKey],
      )
      return (
        <div data-testid="conversation">
          <span data-testid="conv-channel">{props.channel.channelID}</span>
          <span data-testid="conv-channel-type">{props.channel.channelType}</span>
          <span data-testid="conv-request-id">{props.initialCompose?.requestId}</span>
          <span data-testid="conv-text">{props.initialCompose?.text}</span>
          <span data-testid="conv-autosend">{String(props.initialCompose?.autoSend)}</span>
        </div>
      )
    },
  }
})

import { DocGuide } from './DocGuide.tsx'

/** Shape the size-regression lock reads: every guide value is a string or a per-kind record. */
type GuideLocale = { guide: Record<string, string | Record<string, string>> }

/**
 * Settle the send that is CURRENTLY on screen, using the requestId the component itself issued.
 * DocGuide correlates callbacks by requestId (a superseded attempt may settle late and must be
 * ignored), so a hard-coded id would be indistinguishable from a stale one and get dropped.
 */
const settleActiveSend = (state: 'sent' | 'failed', reason?: string) => {
  const props = lastConversationProps!
  props.onInitialComposeStateChange!(props.initialCompose!.requestId, state, reason)
}

/**
 * Mount the guide with its dialog already open, wiring the roster to `bots` (or an error).
 *
 * The roster is owner-dimension ONLY: `GET /robot/owned_bots` = bots the caller CREATED, active, in
 * this space (owner decision, revised 2026-07-28 — the earlier friend ∪ owner union was dropped).
 */
const openGuide = async (
  bots: Array<{ uid: string; name?: string; avatar?: string }> | 'error',
  kind: 'doc' | 'sheet' | 'board' | 'html' = 'sheet',
) => {
  const wk = createMockWKApp()
  wk.apiClient.responder = (_m, url) => {
    if (url.startsWith('/robot/owned_bots')) {
      if (bots === 'error') throw new Error('boom')
      return { data: bots, status: 200 }
    }
    return { data: {}, status: 200 }
  }
  setWKApp(wk)
  render(<DocGuide kind={kind} space="s_1" />)
  await act(async () => {
    fireEvent.click(screen.getByTestId('doc-guide-btn'))
  })
  return wk
}

const pickBot = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByTestId('doc-guide-forward'))
  })
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy())
  await act(async () => {
    fireEvent.click(screen.getByText(name))
  })
  await act(async () => {
    fireEvent.click(screen.getByTestId('doc-guide-picker-confirm'))
  })
}

beforeEach(() => {
  // Forward calls accumulate across cases; a leftover entry would satisfy a later assertion for
  // the wrong reason, and a leftover impl would hijack the next case's outcome.
  forwardPlainTextCalls.length = 0
  setForwardPlainTextImpl(null)
  lastConversationProps = null
  conversationMounts = 0
  // Drafts persist per channel across mounts by design, so they must be reset between tests or a
  // leftover value from a previous case would satisfy the draft assertions for the wrong reason.
  persistedDrafts.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DocGuide — 复制提示词', () => {
  it('copies the prompt built from the panel body and flips the label to 已复制', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await openGuide([], 'board')

    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy'))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    // The prompt is assembled from the SAME i18n values the panel renders (the stub returns keys),
    // so the per-kind command block and skill-file callout must both be present and kind-routed.
    expect(text).toContain('docs.guide.promptIntro')
    expect(text).toContain('docs.guide.cmd.board')
    expect(text).toContain('docs.guide.skillFile.board')
    expect(text).not.toContain('docs.guide.cmd.doc')
    expect(screen.getByTestId('doc-guide-copy').textContent).toBe('docs.guide.copied')
  })

  it('does not claim success when the clipboard API is missing or denied', async () => {
    // `?.writeText` on a missing clipboard resolves to undefined — a naive implementation would
    // flash "已复制" while nothing was copied.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await openGuide([])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy'))
    })
    expect(screen.getByTestId('doc-guide-copy').textContent).toBe('docs.guide.copyPrompt')

    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy'))
    })
    expect(screen.getByTestId('doc-guide-copy').textContent).toBe('docs.guide.copyPrompt')
  })

  it('keeps every locale/kind prompt inside the host message-length limit', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    // The prompt is sent as ONE chat message, and the host rejects anything over MAX_MESSAGE_LENGTH
    // (5000, packages/dmworkbase/src/Components/MessageInput/constants.ts). Copy is naturally the
    // longest locale, so pin the real strings here: a future copy edit that pushes any kind over the
    // limit would otherwise only surface as a failed forward in production.
    for (const locale of ['zh-CN', 'en-US'] as const) {
      const bundle = (await import(`../i18n/${locale}.json`)).default as {
        guide: Record<string, unknown>
      }
      const g = bundle.guide
      for (const kind of ['doc', 'sheet', 'board', 'html'] as const) {
        const text = [
          g.promptIntro,
          g.prereqTitle,
          g.prereqBody,
          g.prereqCode,
          g.cmdTitle,
          (g.cmd as Record<string, string>)[kind],
          g.practiceTitle,
          g.practiceBody,
          g.pitfallTitle,
          g.pitfallAnchor,
          g.pitfallProfile,
          g.pitfallBaseUrl,
          g.pitfallVersion,
          g.skillTitle,
          g.skillBody,
          g.skillCode,
          (g.skillFile as Record<string, string>)[kind],
          g.skillInstall,
        ].join('\n')
        expect(text.length, `${locale}/${kind} prompt length`).toBeLessThan(MAX_MESSAGE_LENGTH)
      }
    }
  })
})

describe('DocGuide — bot picker roster', () => {
  it('lists only the bots the caller CREATED, from GET /robot/owned_bots, space-scoped', async () => {
    const wk = await openGuide([{ uid: 'b1', name: 'bot-alpha' }, { uid: 'b2', name: 'bot-beta' }])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('bot-alpha')).toBeTruthy())
    expect(screen.getByText('bot-beta')).toBeTruthy()
    // The roster is the friend dimension (已添加 AI), scoped to the doc's space — not the space's
    // full bot list, which would surface agents the caller has not befriended.
    const call = wk.apiClient.calls.find((c) => c.url.startsWith('/robot/owned_bots'))
    expect(call?.url).toBe('/robot/owned_bots?space_id=s_1')
  })

  it('confirm stays disabled until a bot is selected', async () => {
    await openGuide([{ uid: 'b1', name: 'bot-alpha' }])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('bot-alpha')).toBeTruthy())
    const confirm = screen.getByTestId('doc-guide-picker-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(screen.getByText('bot-alpha'))
    })
    expect(confirm.disabled).toBe(false)
  })

  it('distinguishes a failed roster fetch from an empty one', async () => {
    // Reporting an outage as "你还没有添加任何 Bot" sends the user hunting for a bot they have.
    await openGuide('error')
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('docs.guide.botsFailed')).toBeTruthy())
    expect(screen.queryByText('docs.guide.noBots')).toBeNull()

    cleanup()
    await openGuide([])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('docs.guide.noBots')).toBeTruthy())
  })

  it('Escape dismisses the picker without tearing down the guide underneath', async () => {
    await openGuide([{ uid: 'b1', name: 'bot-alpha' }])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByTestId('doc-guide-picker')).toBeTruthy())
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByTestId('doc-guide-picker')).toBeNull()
    // The guide itself is still open — Escape closed the top layer only.
    expect(screen.getByTestId('doc-guide-body')).toBeTruthy()
  })

  it('does not leak a previous selection or search term into the next open', async () => {
    await openGuide([{ uid: 'b1', name: 'bot-alpha' }, { uid: 'b2', name: 'other' }])
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('bot-alpha')).toBeTruthy())
    await act(async () => {
      fireEvent.click(screen.getByText('bot-alpha'))
      fireEvent.change(screen.getByPlaceholderText('docs.guide.searchBot'), {
        target: { value: 'bot-alpha' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('docs.guide.cancel'))
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-forward'))
    })
    await waitFor(() => expect(screen.getByText('other')).toBeTruthy())
    // Filter reset (both rows visible) and nothing pre-selected, so a stray Confirm cannot fire off
    // a send to whoever happened to be picked last time.
    expect((screen.getByPlaceholderText('docs.guide.searchBot') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('doc-guide-picker-confirm') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('DocGuide — 转发给 Bot send', () => {
  // The send goes through the host's own forward path (forwardPlainText -> ForwardService.send), the
  // same mechanism behind 转发到聊天. There is no composer, no draft and no channel takeover, so the
  // whole class of defects the previous hidden-Conversation implementation needed patches for
  // (draft poisoning, cross-talk between attempts, swallowed unread state) cannot occur — these
  // cases assert the call itself plus the outcomes the user sees.
  it('forwards the prompt to the chosen bot on the bot Person channel, scoped to the space', async () => {
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() => expect(forwardPlainTextCalls).toHaveLength(1))
    const call = forwardPlainTextCalls[0]
    expect(call.channels).toHaveLength(1)
    expect(call.channels[0].channelID).toBe('b_1')
    expect(call.channels[0].channelType).toBe(1) // ChannelTypePerson
    expect(call.opts?.spaceId).toBe('s_1')
    // The forwarded text is the assembled prompt, not a bare title/link.
    expect(call.text).toContain('docs.guide.promptIntro')
    expect(call.text).toContain('docs.guide.cmd.sheet')
  })

  it('reports sent, naming the bot', async () => {
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() =>
      expect(screen.getByTestId('doc-guide-sendstatus').getAttribute('data-state')).toBe('sent'),
    )
    // The i18n stub appends the interpolation payload, which is exactly what proves the bot name is
    // passed through `values` (not hand-spliced into the string).
    expect(screen.getByTestId('doc-guide-sendstatus').textContent).toBe(
      'docs.guide.sentTo|{"name":"Alpha"}',
    )
  })

  it('reports failed when the host rejects', async () => {
    setForwardPlainTextImpl(() => Promise.reject(new Error('nope')))
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() =>
      expect(screen.getByTestId('doc-guide-sendstatus').getAttribute('data-state')).toBe('failed'),
    )
    expect(screen.getByTestId('doc-guide-sendstatus').textContent).toBe('docs.guide.sendFailed')
  })

  it('treats a resolved-but-undelivered result as a failure, not a success', async () => {
    // ForwardService reports per-target outcomes instead of throwing, so a resolved promise with
    // failedTargets > 0 must NOT be shown as "已发送" — that would be a false confirmation.
    setForwardPlainTextImpl(() => Promise.resolve({ targets: 1, failedTargets: 1 }))
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() =>
      expect(screen.getByTestId('doc-guide-sendstatus').getAttribute('data-state')).toBe('failed'),
    )
  })

  it('does not start a second forward while one is still in flight', async () => {
    let release: (() => void) | null = null
    setForwardPlainTextImpl(
      () => new Promise((res) => { release = () => res({ targets: 1, failedTargets: 0 }) }),
    )
    await openGuide([{ uid: 'b_1', name: 'Alpha' }, { uid: 'b_2', name: 'Beta' }])
    await pickBot('Alpha')
    await waitFor(() => expect(forwardPlainTextCalls).toHaveLength(1))
    // A second confirm mid-flight must be ignored rather than queueing another send.
    await pickBot('Beta')
    expect(forwardPlainTextCalls).toHaveLength(1)
    await act(async () => {
      release?.()
    })
  })

  it('re-picking the same bot really sends again', async () => {
    // The old implementation could silently no-op on a retry (a Conversation consumes each
    // requestId once). A direct call has no such state, so a second confirm is a second send.
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() => expect(forwardPlainTextCalls).toHaveLength(1))
    await pickBot('Alpha')
    await waitFor(() => expect(forwardPlainTextCalls).toHaveLength(2))
  })

  it('clears the outcome when the dialog is closed, so a stale status never greets the next open', async () => {
    await openGuide([{ uid: 'b_1', name: 'Alpha' }])
    await pickBot('Alpha')
    await waitFor(() => expect(screen.getByTestId('doc-guide-sendstatus')).toBeTruthy())
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })
    expect(screen.queryByTestId('doc-guide-sendstatus')).toBeNull()
  })
})

describe('DocGuide — the prompt identifies THIS document', () => {
  // Owner requirement (2026-07-28): a bot driving octo-cli needs the document's own identifiers —
  // above all its docId — or the commands are abstract and it cannot act on the doc you are in.
  const copiedText = async (): Promise<string> => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy'))
    })
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    return writeText.mock.calls[0][0] as string
  }

  it('embeds the docId (and space) in the forwarded prompt', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = () => ({ data: [], status: 200 })
    setWKApp(wk)
    render(<DocGuide kind="sheet" space="s_1" docId="d_target_42" title="Q3 预算" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })
    const text = await copiedText()
    expect(text).toContain('d_target_42')
    expect(text).toContain('s_1')
    expect(text).toContain('Q3 预算')
  })

  it('shows the same ids in the panel, so panel and prompt cannot drift', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = () => ({ data: [], status: 200 })
    setWKApp(wk)
    render(<DocGuide kind="doc" space="s_9" docId="d_shown" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })
    const info = screen.getByTestId('doc-guide-docinfo')
    expect(info.textContent).toContain('d_shown')
    expect(info.textContent).toContain('s_9')
  })

  it('omits the block entirely when no docId was passed (never prints "undefined")', async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = () => ({ data: [], status: 200 })
    setWKApp(wk)
    render(<DocGuide kind="board" space="s_1" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })
    expect(screen.queryByTestId('doc-guide-docinfo')).toBeNull()
    const text = await copiedText()
    expect(text).not.toContain('undefined')
  })

  it('stays within the host send limit for every kind and locale', async () => {
    // ForwardService bypasses MessageInput's own guard, so the prompt must fit MAX_MESSAGE_LENGTH
    // on its own. Locking it here means a future copy edit fails the build, not the user's send.
    const zh = (await import('../i18n/zh-CN.json')).default as unknown as GuideLocale
    const en = (await import('../i18n/en-US.json')).default as unknown as GuideLocale
    for (const locale of [zh, en]) {
      const g = locale.guide
      for (const kind of ['doc', 'sheet', 'board', 'html'] as const) {
        const size =
          Object.values(g)
            .map((v) => (typeof v === 'string' ? v : (v as Record<string, string>)[kind] ?? ''))
            .join('\n').length + 200 // headroom for the doc-info block's ids
        expect(size).toBeLessThan(MAX_MESSAGE_LENGTH)
      }
    }
  })
})

describe('DocGuide — per-section copy', () => {
  // Owner requirement (2026-07-28): every block gets its own copy icon, so a user can take just the
  // install commands or just this document's ids without copying the whole prompt.
  const mountOpen = async () => {
    const wk = createMockWKApp()
    wk.apiClient.responder = () => ({ data: [], status: 200 })
    setWKApp(wk)
    render(<DocGuide kind="sheet" space="s_1" docId="d_sec" title="T" />)
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-btn'))
    })
  }

  it('offers a copy button on every section', async () => {
    await mountOpen()
    for (const id of ['docinfo', 'prereq', 'cmd', 'practice', 'pitfall', 'skill']) {
      expect(screen.getByTestId(`doc-guide-copy-${id}`)).toBeTruthy()
    }
  })

  it('copies only that section, and its text matches what the full prompt embeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await mountOpen()

    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy-cmd'))
    })
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const section = writeText.mock.calls[0][0] as string
    // Scoped: the command block, not the whole guide.
    expect(section).toContain('docs.guide.cmd.sheet')
    expect(section).not.toContain('docs.guide.pitfallAnchor')

    // And byte-identical to the corresponding slice of the forwarded prompt (single source).
    writeText.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy'))
    })
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(writeText.mock.calls[0][0] as string).toContain(section)
  })

  it('confirms on the section that was copied, not the others', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    await mountOpen()
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy-prereq'))
    })
    await waitFor(() =>
      expect(screen.getByTestId('doc-guide-copy-prereq').getAttribute('title')).toBe(
        'docs.guide.copied',
      ),
    )
    expect(screen.getByTestId('doc-guide-copy-cmd').getAttribute('title')).toBe(
      'docs.guide.copySection',
    )
  })

  it('never claims a section was copied when the Clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    await mountOpen()
    await act(async () => {
      fireEvent.click(screen.getByTestId('doc-guide-copy-skill'))
    })
    expect(screen.getByTestId('doc-guide-copy-skill').getAttribute('title')).toBe(
      'docs.guide.copySection',
    )
  })
})
