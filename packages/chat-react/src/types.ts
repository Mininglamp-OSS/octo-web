import type { ChatChannelRef } from '@octo/chat-core'

/* ------------------------------------------------------------------ */
/*  Host capabilities — implementors provide these to the provider.   */
/* ------------------------------------------------------------------ */

export interface ChatDownloadRequest {
  url: string
  filename?: string
}

export interface ChatDownloadResult {
  localPath?: string
  blob?: Blob
}

export interface ChatFilePickerOptions {
  accept?: string
  multiple?: boolean
}

export interface ChatNotificationOptions {
  title: string
  body?: string
  icon?: string
}

export interface ChatTelemetryEvent {
  name: string
  payload?: Record<string, unknown>
}

export interface ChatFeatureError {
  message: string
  code?: string
  stack?: string
}

export interface ChatHostCapabilities {
  openExternal?(url: string): Promise<void>
  download?(request: ChatDownloadRequest): Promise<ChatDownloadResult>
  chooseFiles?(options: ChatFilePickerOptions): Promise<File[]>
  notify?(options: ChatNotificationOptions): Promise<void>
  requestMediaPermission?(kind: 'audio'): Promise<boolean>
  openUserProfile?(uid: string, context?: ChatChannelRef): void
  reportTelemetry?(event: ChatTelemetryEvent): void
  reportError?(error: ChatFeatureError): void
}

/* ------------------------------------------------------------------ */
/*  ConversationWindow data exposed to render-function children.      */
/* ------------------------------------------------------------------ */

export interface ConversationWindowData {
  readonly channel: ChatChannelRef
  readonly isLeased: boolean
  /** Present in current implementations; optional for legacy structural consumers. */
  readonly error?: Error | null
  /** Present in current implementations; optional for legacy structural consumers. */
  retry?(): void
}
