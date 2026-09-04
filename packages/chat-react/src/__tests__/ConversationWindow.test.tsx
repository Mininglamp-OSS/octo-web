import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatProvider } from '../ChatProvider'
import { ConversationWindow } from '../ConversationWindow'
import {
  ChatClientEvent,
  ChatClientStatus,
  createMockClient,
  channelA,
  channelB,
  type MockChatClient,
} from './mockChatCore'

describe('ConversationWindow', () => {
  let client: MockChatClient

  beforeEach(() => {
    client = createMockClient()
  })

  function shell(ui: React.ReactElement) {
    return <ChatProvider client={client}>{ui}</ChatProvider>
  }

  it('acquires a lease on mount and releases on unmount', async () => {
    const { unmount } = render(shell(<ConversationWindow channel={channelA} />))

    await waitFor(() => {
      expect(client.openCalls).toHaveLength(1)
    })
    expect(client.openCalls[0]).toEqual(channelA)
    expect(client.leases[0].released).toBe(false)

    unmount()
    await waitFor(() => {
      expect(client.leases[0].released).toBe(true)
    })
  })

  it('releases old lease and acquires new lease when channel changes', async () => {
    const { rerender } = render(shell(<ConversationWindow channel={channelA} />))

    await waitFor(() => {
      expect(client.openCalls).toHaveLength(1)
    })
    expect(client.openCalls[0]).toEqual(channelA)

    rerender(shell(<ConversationWindow channel={channelB} />))

    await waitFor(() => {
      expect(client.openCalls).toHaveLength(2)
    })
    expect(client.openCalls[1]).toEqual(channelB)

    expect(client.leases[0].released).toBe(true)
    expect(client.leases[1].released).toBe(false)
  })

  it('releases lease when activate changes from true to false', async () => {
    const { rerender } = render(
      shell(<ConversationWindow channel={channelA} activate />),
    )

    await waitFor(() => {
      expect(client.openCalls).toHaveLength(1)
    })

    rerender(
      shell(<ConversationWindow channel={channelA} activate={false} />),
    )

    await waitFor(() => {
      expect(client.leases[0].released).toBe(true)
    })
    expect(client.openCalls).toHaveLength(1)
  })

  it('does not acquire lease when activate is false', () => {
    render(shell(<ConversationWindow channel={channelA} activate={false} />))

    expect(client.openCalls).toHaveLength(0)
  })

  it('renders children as static ReactNode', () => {
    render(
      shell(
        <ConversationWindow channel={channelA}>
          <span data-testid="child">hello</span>
        </ConversationWindow>,
      ),
    )
    expect(screen.getByTestId('child')).toHaveTextContent('hello')
  })

  it('renders children as render function with data', async () => {
    render(
      shell(
        <ConversationWindow channel={channelA}>
          {(data) => (
            <span data-testid="render-child">
              {data.channel.channelId}:{data.isLeased ? 'leased' : 'pending'}
            </span>
          )}
        </ConversationWindow>,
      ),
    )

    await waitFor(() => {
      expect(screen.getByTestId('render-child')).toHaveTextContent(
        'channel-a:leased',
      )
    })
  })

  it('exposes real open errors and supports an explicit retry', async () => {
    const openError = new Error('open failed')
    const onError = vi.fn()
    const originalOpen = client.openConversation.bind(client)
    let attempts = 0
    client.openConversation = vi.fn(async (channel) => {
      attempts += 1
      if (attempts === 1) throw openError
      return originalOpen(channel)
    })

    render(
      shell(
        <ConversationWindow channel={channelA} onError={onError}>
          {(data) => (
            <button type="button" onClick={data.retry}>
              {data.error?.message || (data.isLeased ? 'leased' : 'pending')}
            </button>
          )}
        </ConversationWindow>,
      ),
    )

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('open failed'))
    expect(onError).toHaveBeenCalledWith(openError)

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('leased'))
    expect(client.openConversation).toHaveBeenCalledTimes(2)
  })

  it('retries a failed open after the client reconnects', async () => {
    const originalOpen = client.openConversation.bind(client)
    let attempts = 0
    client.openConversation = vi.fn(async (channel) => {
      attempts += 1
      if (attempts === 1) throw new Error('connection lost')
      return originalOpen(channel)
    })

    render(
      shell(
        <ConversationWindow channel={channelA}>
          {(data) => (
            <span>{data.error?.message || (data.isLeased ? 'leased' : 'pending')}</span>
          )}
        </ConversationWindow>,
      ),
    )

    await waitFor(() => expect(screen.getByText('connection lost')).toBeInTheDocument())
    client.emit(ChatClientEvent.StatusChanged, ChatClientStatus.Connected)
    await waitFor(() => expect(screen.getByText('leased')).toBeInTheDocument())
    expect(client.openConversation).toHaveBeenCalledTimes(2)
  })

  it('reopens the conversation after an externally managed stop and restart', async () => {
    render(
      shell(
        <ConversationWindow channel={channelA}>
          {(data) => (
            <span>{data.isLeased ? 'leased' : 'pending'}</span>
          )}
        </ConversationWindow>,
      ),
    )

    await waitFor(() => expect(screen.getByText('leased')).toBeInTheDocument())

    await act(async () => {
      await client.stop()
    })
    expect(screen.getByText('pending')).toBeInTheDocument()

    await act(async () => {
      await client.start({ token: 'replacement' })
    })
    await waitFor(() => expect(screen.getByText('leased')).toBeInTheDocument())
    expect(client.openCalls).toEqual([channelA, channelA])
  })

  it('discards a pending lease that resolves after the client stops', async () => {
    client.deferNextOpen()
    render(
      shell(
        <ConversationWindow channel={channelA}>
          {(data) => <span>{data.isLeased ? 'leased' : 'pending'}</span>}
        </ConversationWindow>,
      ),
    )

    expect(client.pendingOpens).toHaveLength(1)
    await act(async () => {
      await client.stop()
      client.resolveNextPending()
      await Promise.resolve()
    })

    await waitFor(() => expect(client.leases[0].released).toBe(true))
    expect(screen.getByText('pending')).toBeInTheDocument()
  })

  it('forwards className and style to a wrapper div', () => {
    render(
      shell(
        <ConversationWindow
          channel={channelA}
          className="my-ctn"
          style={{ padding: 8 }}
        >
          <span data-testid="inner" />
        </ConversationWindow>,
      ),
    )
    const wrapper = screen.getByTestId('inner').parentElement!
    expect(wrapper.className).toBe('my-ctn')
    expect(wrapper.style.padding).toBe('8px')
  })

  describe('async race guards', () => {
    it('releases late-arriving lease if channel changes before open resolves', async () => {
      client.deferNextOpen()

      const { rerender } = render(shell(<ConversationWindow channel={channelA} />))
      expect(client.openCalls).toHaveLength(1)
      expect(client.pendingOpens).toHaveLength(1)

      // Switch to channelB while channelA open is still pending.
      rerender(shell(<ConversationWindow channel={channelB} />))

      // channelB opens immediately (not deferred)
      await waitFor(() => {
        expect(client.openCalls).toHaveLength(2)
      })
      expect(client.openCalls[1]).toEqual(channelB)
      expect(client.leases[1].released).toBe(false)

      // Now resolve the stale channelA open.  Its lease must be
      // released by the guard.
      client.resolveNextPending()
      await waitFor(() => {
        expect(client.leases[0].released).toBe(true)
      })

      // channelB lease must not have been touched.
      expect(client.leases[1].released).toBe(false)
    })

    it('releases lease when open resolves after unmount', async () => {
      client.deferNextOpen()

      const { unmount } = render(shell(<ConversationWindow channel={channelA} />))
      expect(client.pendingOpens).toHaveLength(1)

      unmount()

      // Resolve the deferred open after unmount — lease must be released.
      client.resolveNextPending()
      await waitFor(() => {
        expect(client.leases[0].released).toBe(true)
      })
    })
  })
})
