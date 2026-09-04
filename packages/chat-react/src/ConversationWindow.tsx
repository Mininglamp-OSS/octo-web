import React, {
  useCallback,
  useState,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import {
  ChatClientEvent,
  ChatClientStatus,
  ChatConversationSupersededError,
  type ChatChannelRef,
  type ChatConversationLease,
} from '@octo/chat-core'
import { useChatClient, useChatHostCapabilities } from './hooks'
import type { ConversationWindowData } from './types'

export type { ConversationWindowData } from './types'

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface ConversationWindowProps {
  /** Target channel to open. */
  channel: ChatChannelRef

  /**
   * Static children, a render function receiving ConversationWindowData,
   * or omitted.
   *
   * - `ReactNode`: rendered directly.
   * - `(data: ConversationWindowData) => ReactNode`: called with current state.
   * - `undefined`: nothing is rendered (the component only manages the lease).
   */
  children?:
    | ReactNode
    | ((data: ConversationWindowData) => ReactNode)

  /**
   * When true (default), mount opens the conversation and unmount / channel
   * changes release the lease. Set to false to defer channel activation.
   */
  activate?: boolean

  /** Additional CSS class name for the stable wrapper. */
  className?: string

  /** Inline styles for the wrapper. */
  style?: React.CSSProperties

  /** Optional stable DOM data attribute value. Defaults to the channel id. */
  'data-channel'?: string

  /** Called when opening the requested conversation fails. */
  onError?: (error: Error) => void
}

/**
 * Binds a conversation channel lifecycle via
 * `ChatClient.openConversation()`.
 *
 * The client's `openConversation` is asynchronous, so this component guards
 * against races:
 *
 * - When `channel` / `client` changes or the component unmounts before a
 *   pending lease resolves, the late-arriving lease is released immediately
 *   — it is never adopted as the active lease, and never calls setState.
 * - When `activate` flips to false, the current lease is released.
 * - Old lease release never clobbers a newer lease because only the effect
 *   instance associated with the current request token may adopt a lease.
 */
export function ConversationWindow({
  channel,
  children,
  activate = true,
  className,
  style,
  'data-channel': dataChannel,
  onError,
}: ConversationWindowProps): JSX.Element {
  const client = useChatClient()
  const host = useChatHostCapabilities()

  const [state, setState] = useState<Omit<ConversationWindowData, 'retry'>>(() => ({
    channel,
    isLeased: false,
    error: null,
  }))
  const [retryVersion, setRetryVersion] = useState(0)

  // Monotonic request token — invalidates stale async openConversation
  // resolutions so only the latest request may adopt its lease.
  const requestRef = useRef(0)
  // Currently adopted lease, if any.  Released synchronously on cleanup.
  const leaseRef = useRef<ChatConversationLease | null>(null)
  // Guards against setState after unmount.
  const mountedRef = useRef(true)
  const failedOpenRef = useRef(false)
  const restartPendingRef = useRef(false)
  const onErrorRef = useRef(onError)
  const hostRef = useRef(host)
  onErrorRef.current = onError
  hostRef.current = host

  const retry = useCallback(() => {
    if (!mountedRef.current) return
    failedOpenRef.current = false
    setRetryVersion((version) => version + 1)
  }, [])

  const data = useMemo<ConversationWindowData>(() => ({
    ...state,
    retry,
  }), [retry, state])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => client.subscribe(
    ChatClientEvent.StatusChanged,
    (status: ChatClientStatus) => {
      if (!mountedRef.current) return

      if (status === ChatClientStatus.Stopped) {
        requestRef.current += 1
        leaseRef.current = null
        failedOpenRef.current = false
        restartPendingRef.current = activate
        setState({ channel, isLeased: false, error: null })
        return
      }

      if (
        status === ChatClientStatus.Connected &&
        (failedOpenRef.current || restartPendingRef.current)
      ) {
        restartPendingRef.current = false
        retry()
      }
    },
  ), [
    activate,
    channel.channelId,
    channel.channelType,
    client,
    retry,
  ])

  useEffect(() => {
    const token = ++requestRef.current

    // Safely release whatever the previous effect adopted.  Because release
    // is idempotent and per-conversation, this cannot touch a lease owned
    // by a newer effect — we haven't adopted one yet.
    if (leaseRef.current && !leaseRef.current.released) {
      leaseRef.current.release()
    }
    leaseRef.current = null

    if (!activate) {
      failedOpenRef.current = false
      setState({ channel, isLeased: false, error: null })
      return
    }

    let cancelled = false
    failedOpenRef.current = false
    restartPendingRef.current = false

    // Reset to unleased while the new request is in flight.
    setState({ channel, isLeased: false, error: null })

    client
      .openConversation(channel)
      .then((lease) => {
        if (cancelled) {
          // Late arrival — unmount or superseding effect already won.
          // Release immediately, never adopt, never setState.
          if (!lease.released) lease.release()
          return
        }
        // Guard: ensure we don't setState if the component unmounted
        // between when start ran and when the promise resolved.
        if (!mountedRef.current) {
          if (!lease.released) lease.release()
          return
        }
        // Guard: this effect has been superseded by a newer request.
        if (requestRef.current !== token) {
          if (!lease.released) lease.release()
          return
        }
        leaseRef.current = lease
        failedOpenRef.current = false
        setState({ channel, isLeased: true, error: null })
      })
      .catch((error: unknown) => {
        if (
          cancelled ||
          !mountedRef.current ||
          requestRef.current !== token ||
          error instanceof ChatConversationSupersededError
        ) return

        const normalized = error instanceof Error ? error : new Error(String(error))
        failedOpenRef.current = true
        setState({ channel, isLeased: false, error: normalized })
        try {
          onErrorRef.current?.(normalized)
        } catch {
          // Consumer error handlers must not escape the lease lifecycle.
        }
        try {
          hostRef.current?.reportError?.({
            message: normalized.message,
            code: 'conversation-open-failed',
            stack: normalized.stack,
          })
        } catch {
          // Host telemetry failures must not create an unhandled rejection.
        }
      })

    return () => {
      cancelled = true
      if (leaseRef.current && !leaseRef.current.released) {
        leaseRef.current.release()
      }
      leaseRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channel.channelId, channel.channelType, activate, retryVersion])

  const rendered =
    typeof children === 'function'
      ? (children as (data: ConversationWindowData) => ReactNode)(data)
      : children

  return (
    <div
      className={className}
      style={style}
      data-channel={dataChannel ?? channel.channelId}
    >
      {rendered}
    </div>
  )
}
