import React, {
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'
import type { ChatClient, ChatChannelRef, ChatConversationLease } from '@octo/chat-core'
import { useChatClient } from './hooks'
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
}: ConversationWindowProps): JSX.Element {
  const client = useChatClient()

  const [data, setData] = useState<ConversationWindowData>(() => ({
    channel,
    isLeased: false,
  }))

  // Monotonic request token — invalidates stale async openConversation
  // resolutions so only the latest request may adopt its lease.
  const requestRef = useRef(0)
  // Currently adopted lease, if any.  Released synchronously on cleanup.
  const leaseRef = useRef<ChatConversationLease | null>(null)
  // Guards against setState after unmount.
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

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
      setData({ channel, isLeased: false })
      return
    }

    let cancelled = false

    // Reset to unleased while the new request is in flight.
    setData({ channel, isLeased: false })

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
        setData({ channel, isLeased: true })
      })
      .catch(() => {
        // openConversation failure leaves the window unleased; the next
        // channel/prop change will re-attempt.
      })

    return () => {
      cancelled = true
      if (leaseRef.current && !leaseRef.current.released) {
        leaseRef.current.release()
      }
      leaseRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channel.channelId, channel.channelType, activate])

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
