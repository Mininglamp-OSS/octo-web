import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { setWKApp } from '../octoweb/index.ts'
import { createMockWKApp } from '../octoweb/mock.ts'
import type { HtmlCreationDraft } from './createHtmlTask.ts'

// Replace ONLY the heavy Conversation with a marker; keep the rest of the seam (Channel,
// ChannelTypePerson, t) real. The marker surfaces the channel it was built with, the auto-sent
// task text + requestId, and exposes the compose-state callback so the shell's status line is
// testable without a live IM channel.
let lastConversationProps: {
  channel: { channelID: string; channelType: number }
  initialCompose?: { requestId: string; text: string; files: File[]; autoSend: boolean }
  onInitialComposeStateChange?: (r: string, s: string, reason?: string) => void
  onMessageSent?: () => void
} | null = null

vi.mock('../octoweb/index.ts', async (importActual) => {
  const actual = (await importActual()) as Record<string, unknown>
  return {
    ...actual,
    Conversation: (props: typeof lastConversationProps) => {
      lastConversationProps = props
      return (
        <div data-testid="conversation">
          <span data-testid="conv-channel">{props!.channel.channelID}</span>
          <span data-testid="conv-channel-type">{props!.channel.channelType}</span>
          <span data-testid="conv-request-id">{props!.initialCompose?.requestId}</span>
          <span data-testid="conv-text">{props!.initialCompose?.text}</span>
          <span data-testid="conv-autosend">{String(props!.initialCompose?.autoSend)}</span>
          <span data-testid="conv-files">{props!.initialCompose?.files.length}</span>
        </div>
      )
    },
  }
})

import { DocsBotConversation } from './DocsBotConversation.tsx'

const draft = (over: Partial<HtmlCreationDraft> = {}): HtmlCreationDraft => ({
  requestId: 'req-abc',
  botUid: 'bot_x',
  botName: 'Publisher',
  description: 'A launch page',
  files: [],
  spaceId: 's_1',
  baseUrl: 'https://octo.example/docs-html/',
  ...over,
})

describe('DocsBotConversation', () => {
  beforeEach(() => {
    lastConversationProps = null
    setWKApp(createMockWKApp())
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('builds a Person channel for the bot uid and renders Conversation', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    expect(screen.getByTestId('conversation')).toBeTruthy()
    expect(screen.getByTestId('conv-channel').textContent).toBe('bot_x')
    // ChannelTypePerson === 1.
    expect(screen.getByTestId('conv-channel-type').textContent).toBe('1')
  })

  it('passes a one-shot auto-send initialCompose carrying the fixed task text + files', () => {
    const f = new File(['x'], 'ref.png', { type: 'image/png' })
    render(<DocsBotConversation draft={draft({ files: [f] })} onClose={() => {}} />)
    expect(screen.getByTestId('conv-request-id').textContent).toBe('req-abc')
    expect(screen.getByTestId('conv-autosend').textContent).toBe('true')
    expect(screen.getByTestId('conv-files').textContent).toBe('1')
    const text = screen.getByTestId('conv-text').textContent || ''
    expect(text).toContain('[Octo HTML 创建任务]')
    expect(text).toContain('request_id: req-abc')
    expect(text).toContain('base_url: https://octo.example/docs-html/')
    // No token anywhere in the auto-sent text.
    expect(text.toLowerCase()).not.toContain('authorization')
  })

  it('shows the bot name and the "create HTML with bot" context in the header', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    expect(screen.getByText('Publisher')).toBeTruthy()
    expect(screen.getByText('docs.list.htmlCreate.chatContext')).toBeTruthy()
  })

  it('reflects prepared / sent / failed compose states (does not fake bot progress)', () => {
    render(<DocsBotConversation draft={draft()} onClose={() => {}} />)
    // No status until the compose reports one.
    expect(screen.queryByRole('status')).toBeNull()
    // Sent, then failed with a reason.
    act(() => lastConversationProps!.onInitialComposeStateChange!('req-abc', 'sent'))
    act(() => lastConversationProps!.onInitialComposeStateChange!('req-abc', 'failed', 'send-failed'))
    // The status region flips to the failed styling hook.
    const status = document.querySelector('.octo-docs-bot-chat-status')
    expect(status?.getAttribute('data-state')).toBe('failed')
  })

  it('close button returns to docs (calls onClose) without deleting the DM', () => {
    const onClose = vi.fn()
    render(<DocsBotConversation draft={draft()} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('docs.list.htmlCreate.close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('forwards onMessageSent to Conversation', () => {
    const onMessageSent = vi.fn()
    render(<DocsBotConversation draft={draft()} onClose={() => {}} onMessageSent={onMessageSent} />)
    lastConversationProps!.onMessageSent!()
    expect(onMessageSent).toHaveBeenCalledTimes(1)
  })
})
