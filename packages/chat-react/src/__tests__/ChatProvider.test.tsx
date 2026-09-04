import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatProvider } from '../ChatProvider'
import { ConversationWindow } from '../ConversationWindow'
import { useChatClient, useChatHostCapabilities } from '../hooks'
import { channelA, createMockClient, type MockChatClient } from './mockChatCore'

describe('ChatProvider', () => {
  let client: MockChatClient

  beforeEach(() => {
    client = createMockClient()
  })

  function Consumer({ label }: { label: string }) {
    const c = useChatClient()
    return (
      <span data-testid={`client-${label}`}>
        {c === client ? 'ok' : 'wrong'}
      </span>
    )
  }

  it('provides ChatClient to children', () => {
    render(
      <ChatProvider client={client}>
        <Consumer label="a" />
      </ChatProvider>,
    )
    expect(screen.getByTestId('client-a')).toHaveTextContent('ok')
  })

  it('does not start/stop client when manageLifecycle is false', async () => {
    const { unmount } = render(
      <ChatProvider client={client} bootstrap={{ channel: { channelId: 'x', channelType: 1 } }}>
        <Consumer label="b" />
      </ChatProvider>,
    )
    expect(client.startCalls).toHaveLength(0)
    expect(client.stopCalls).toBe(0)
    unmount()
    expect(client.stopCalls).toBe(0)
  })

  it('starts client on mount and stops on unmount when manageLifecycle is true', async () => {
    const bootstrap = { initialChannel: { channelId: 'test', channelType: 1 }, token: 't1' }
    const { unmount } = render(
      <ChatProvider client={client} bootstrap={bootstrap} manageLifecycle>
        <Consumer label="c" />
      </ChatProvider>,
    )

    await waitFor(() => {
      expect(client.startCalls).toHaveLength(1)
    })
    expect(client.startCalls[0].token).toBe('t1')

    unmount()
    await waitFor(() => {
      expect(client.stopCalls).toBe(1)
    })
  })

  it('does not mount conversation children until managed startup resolves', async () => {
    let resolveStart: (() => void) | undefined
    let started = false
    client.start = vi.fn(async (bootstrap) => {
      client.startCalls.push(bootstrap)
      await new Promise<void>((resolve) => {
        resolveStart = () => {
          started = true
          resolve()
        }
      })
    })
    const originalOpen = client.openConversation.bind(client)
    client.openConversation = vi.fn(async (channel) => {
      if (!started) throw new Error('client is not started')
      return originalOpen(channel)
    })

    render(
      <ChatProvider client={client} bootstrap={{ token: 't1' }} manageLifecycle>
        <ConversationWindow channel={channelA} />
      </ChatProvider>,
    )

    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1))
    expect(client.openConversation).not.toHaveBeenCalled()

    resolveStart?.()
    await waitFor(() => expect(client.openConversation).toHaveBeenCalledTimes(1))
  })

  it('does not restart for an equivalent bootstrap object', async () => {
    const { rerender, unmount } = render(
      <ChatProvider
        client={client}
        bootstrap={{ token: 't1', space: 'space-a' }}
        manageLifecycle
      >
        <Consumer label="stable" />
      </ChatProvider>,
    )

    await waitFor(() => expect(client.startCalls).toHaveLength(1))

    rerender(
      <ChatProvider
        client={client}
        bootstrap={{ token: 't1', space: 'space-a' }}
        manageLifecycle
      >
        <Consumer label="stable" />
      </ChatProvider>,
    )

    expect(client.startCalls).toHaveLength(1)
    expect(client.stopCalls).toBe(0)

    unmount()
    await waitFor(() => expect(client.stopCalls).toBe(1))
  })

  it('waits for managed stop before starting a replacement lifecycle', async () => {
    let resolveStop: (() => void) | undefined
    client.stop = vi.fn(async () => {
      client.stopCalls += 1
      await new Promise<void>((resolve) => {
        resolveStop = resolve
      })
    })

    const { rerender } = render(
      <ChatProvider client={client} bootstrap={{ token: 't1' }} manageLifecycle>
        <Consumer label="queued" />
      </ChatProvider>,
    )
    await waitFor(() => expect(client.startCalls).toHaveLength(1))

    rerender(
      <ChatProvider client={client} bootstrap={{ token: 't2' }} manageLifecycle>
        <Consumer label="queued" />
      </ChatProvider>,
    )

    await waitFor(() => expect(client.stop).toHaveBeenCalledTimes(1))
    expect(client.startCalls).toHaveLength(1)

    resolveStop?.()
    await waitFor(() => expect(client.startCalls).toHaveLength(2))
    expect(client.startCalls[1].token).toBe('t2')
  })

  it('blocks a replacement client until a failed stop is retried successfully', async () => {
    const replacementClient = createMockClient()
    const stopError = new Error('stop failed')
    const onLifecycleError = vi.fn()
    const originalStop = client.stop.bind(client)
    let stopAttempts = 0
    client.stop = vi.fn(async () => {
      stopAttempts += 1
      if (stopAttempts === 1) {
        client.stopCalls += 1
        throw stopError
      }
      await originalStop()
    })

    const { rerender } = render(
      <ChatProvider client={client} bootstrap={{ token: 't1' }} manageLifecycle>
        <span>initial client ready</span>
      </ChatProvider>,
    )
    await waitFor(() => expect(client.startCalls).toHaveLength(1))

    rerender(
      <ChatProvider
        client={replacementClient}
        bootstrap={{ token: 't2' }}
        manageLifecycle
        onLifecycleError={onLifecycleError}
        lifecycleFallback={({ error, retry }) => (
          <button type="button" onClick={retry}>{error.message}</button>
        )}
      >
        <span>replacement client ready</span>
      </ChatProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('stop failed'))
    expect(client.stop).toHaveBeenCalledTimes(1)
    expect(replacementClient.startCalls).toHaveLength(0)
    expect(onLifecycleError).toHaveBeenCalledTimes(1)
    expect(onLifecycleError).toHaveBeenCalledWith(stopError)

    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByText('replacement client ready')).toBeInTheDocument())
    expect(client.stop).toHaveBeenCalledTimes(2)
    expect(replacementClient.startCalls).toHaveLength(1)
    expect(replacementClient.startCalls[0].token).toBe('t2')
  })

  it('exposes managed startup failure and recovers through retry', async () => {
    const startError = new Error('start failed')
    const onLifecycleError = vi.fn()
    const originalStart = client.start.bind(client)
    let attempts = 0
    client.start = vi.fn(async (bootstrap) => {
      attempts += 1
      if (attempts === 1) throw startError
      return originalStart(bootstrap)
    })

    render(
      <ChatProvider
        client={client}
        bootstrap={{ token: 't1' }}
        manageLifecycle
        onLifecycleError={onLifecycleError}
        lifecycleFallback={({ error, retry }) => (
          <button type="button" onClick={retry}>{error.message}</button>
        )}
      >
        <Consumer label="recovered" />
      </ChatProvider>,
    )

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('start failed'))
    expect(onLifecycleError).toHaveBeenCalledWith(startError)
    expect(screen.queryByTestId('client-recovered')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByTestId('client-recovered')).toHaveTextContent('ok'))
    expect(client.start).toHaveBeenCalledTimes(2)
  })

  it('throws when useChatClient is called outside ChatProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Bad() {
      useChatClient()
      return null
    }
    expect(() => render(<Bad />)).toThrow('useChatClient')

    consoleSpy.mockRestore()
  })
})

describe('useChatHostCapabilities', () => {
  let client: MockChatClient

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns undefined when host is not provided', () => {
    function Reader() {
      const caps = useChatHostCapabilities()
      return <span data-testid="caps">{caps === undefined ? 'undef' : 'set'}</span>
    }
    render(
      <ChatProvider client={client}>
        <Reader />
      </ChatProvider>,
    )
    expect(screen.getByTestId('caps')).toHaveTextContent('undef')
  })

  it('returns host capabilities when provided', () => {
    const host = {
      openExternal: async () => {},
      notify: async () => {},
    }
    function Reader() {
      const caps = useChatHostCapabilities()
      return <span data-testid="caps">{caps === host ? 'match' : 'mismatch'}</span>
    }
    render(
      <ChatProvider client={client} host={host}>
        <Reader />
      </ChatProvider>,
    )
    expect(screen.getByTestId('caps')).toHaveTextContent('match')
  })
})
