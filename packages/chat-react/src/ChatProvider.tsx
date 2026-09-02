import React, { useEffect, useRef, useMemo, type ReactNode } from "react";
import type { ChatClient, ChatClientBootstrap } from "@octo/chat-core";
import type { ChatHostCapabilities } from "./types";
import { ChatContext, ChatHostContext } from "./ChatContext";

export interface ChatProviderProps {
  /** Explicit ChatClient instance. Required. */
  client: ChatClient;

  /** Optional host capabilities for platform actions. */
  host?: ChatHostCapabilities;

  /** Bootstrap config passed to client.start() when manageLifecycle is true. */
  bootstrap?: ChatClientBootstrap;

  /**
   * When true (and bootstrap is provided), the provider calls
   * client.start(bootstrap) on mount and client.stop() on unmount.
   * Defaults to false — the host manages client lifecycle.
   */
  manageLifecycle?: boolean;

  children: ReactNode;
}

/**
 * Provides a ChatClient and optional HostCapabilities to the React tree.
 *
 * By default the provider does NOT own the client lifecycle; pass both
 * `bootstrap` and `manageLifecycle` to have it call start/stop automatically.
 */
export function ChatProvider({
  client,
  host,
  bootstrap,
  manageLifecycle = false,
  children,
}: ChatProviderProps): JSX.Element {
  const startedRef = useRef(false);

  useEffect(() => {
    if (!manageLifecycle || !bootstrap) return;

    let cancelled = false;

    void client
      .start(bootstrap)
      .then(() => {
        if (!cancelled) startedRef.current = true;
      })
      .catch(() => {
        startedRef.current = false;
      });

    return () => {
      cancelled = true;
      startedRef.current = false;
      void client.stop().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, bootstrap, manageLifecycle]);

  const ctx = useMemo(() => ({ client, host }), [client, host]);

  return (
    <ChatContext.Provider value={ctx}>
      <ChatHostContext.Provider value={host}>
        {children}
      </ChatHostContext.Provider>
    </ChatContext.Provider>
  );
}
