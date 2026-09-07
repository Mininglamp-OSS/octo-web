import { createContext } from 'react'
import type { ChatClient } from '@octo/chat-core'
import type { ChatHostCapabilities } from './types'

export interface ChatContextValue {
  client: ChatClient
  host?: ChatHostCapabilities
}

export const ChatContext = createContext<ChatContextValue | null>(null)
export const ChatHostContext = createContext<ChatHostCapabilities | undefined>(undefined)
