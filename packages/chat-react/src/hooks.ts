import { useContext } from 'react'
import type { ChatClient } from '@octo/chat-core'
import type { ChatHostCapabilities } from './types'
import { ChatContext, ChatHostContext } from './ChatContext'

/**
 * Returns the current ChatClient from the nearest ChatProvider.
 * Throws if called outside a ChatProvider.
 */
export function useChatClient(): ChatClient {
  const ctx = useContext(ChatContext)
  if (!ctx) {
    throw new Error(
      'useChatClient must be used within a <ChatProvider>. ' +
        'Wrap the component tree with a ChatProvider and pass a client.',
    )
  }
  return ctx.client
}

/**
 * Returns the ChatHostCapabilities from the nearest ChatProvider, or
 * undefined if the host did not provide capabilities.
 */
export function useChatHostCapabilities(): ChatHostCapabilities | undefined {
  return useContext(ChatHostContext)
}
