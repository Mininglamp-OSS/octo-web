import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ChatProvider } from '../ChatProvider'
import { useChatClient, useChatHostCapabilities } from '../hooks'
import { createMockClient, type MockChatClient } from './mockChatCore'

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
    const bootstrap = { channel: { channelId: 'test', channelType: 1 }, token: 't1' }
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
