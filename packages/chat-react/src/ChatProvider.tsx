import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

  /** Rendered when a managed lifecycle operation fails. */
  lifecycleFallback?:
    | ReactNode
    | ((state: ChatProviderLifecycleFailure) => ReactNode);

  /** Called when a managed lifecycle operation fails. */
  onLifecycleError?: (error: Error) => void;

  children: ReactNode;
}

export interface ChatProviderLifecycleFailure {
  error: Error;
  retry(): void;
}

interface PendingManagedStop {
  client: ChatClient;
  error?: Error;
  reported: boolean;
}

function normalizeLifecycleError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
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
  lifecycleFallback,
  onLifecycleError,
  children,
}: ChatProviderProps): JSX.Element {
  const managedBootstrap = useMemo<ChatClientBootstrap | null>(() => {
    if (!manageLifecycle || !bootstrap) return null;
    return {
      endpoint: bootstrap.endpoint,
      token: bootstrap.token,
      session: bootstrap.session,
      space: bootstrap.space,
      initialChannel: bootstrap.initialChannel
        ? {
            channelId: bootstrap.initialChannel.channelId,
            channelType: bootstrap.initialChannel.channelType,
          }
        : undefined,
    };
  }, [
    manageLifecycle,
    bootstrap?.endpoint,
    bootstrap?.token,
    bootstrap?.session,
    bootstrap?.space,
    bootstrap?.initialChannel?.channelId,
    bootstrap?.initialChannel?.channelType,
  ]);
  const [readyLifecycle, setReadyLifecycle] = useState<{
    client: ChatClient;
    bootstrap: ChatClientBootstrap;
  } | null>(null);
  const [lifecycleError, setLifecycleError] = useState<Error | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const lifecycleQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingStopRef = useRef<PendingManagedStop | null>(null);
  const retryPendingStopRef = useRef(false);
  const hostRef = useRef(host);
  const onLifecycleErrorRef = useRef(onLifecycleError);
  hostRef.current = host;
  onLifecycleErrorRef.current = onLifecycleError;

  const reportLifecycleError = useCallback((error: Error, code: string) => {
    try {
      onLifecycleErrorRef.current?.(error);
    } catch {
      // Consumer error callbacks must not escape the lifecycle effect.
    }
    try {
      hostRef.current?.reportError?.({
        message: error.message,
        code,
        stack: error.stack,
      });
    } catch {
      // Host telemetry failures must not create an unhandled rejection.
    }
  }, []);

  const retryLifecycle = useCallback(() => {
    retryPendingStopRef.current = true;
    setLifecycleError(null);
    setRetryVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!managedBootstrap) {
      setReadyLifecycle(null);
      setLifecycleError(null);
      return;
    }

    let cancelled = false;
    let startAttempted = false;
    let failureCode = "chat-client-start-failed";
    let errorAlreadyReported = false;
    const retryPendingStop = retryPendingStopRef.current;
    retryPendingStopRef.current = false;
    setReadyLifecycle(null);
    setLifecycleError(null);

    const startTask = lifecycleQueueRef.current
      .then(async () => {
        if (cancelled) return;

        const pendingStop = pendingStopRef.current;
        if (pendingStop) {
          failureCode = "chat-client-stop-failed";
          if (!retryPendingStop) {
            errorAlreadyReported = pendingStop.reported;
            throw pendingStop.error ?? new Error("Previous chat client cleanup is incomplete.");
          }

          try {
            await pendingStop.client.stop();
            if (pendingStopRef.current === pendingStop) {
              pendingStopRef.current = null;
            }
          } catch (error) {
            const normalized = normalizeLifecycleError(error);
            pendingStop.error = normalized;
            pendingStop.reported = false;
            throw normalized;
          }
        }

        if (cancelled) return;
        failureCode = "chat-client-start-failed";
        startAttempted = true;
        await client.start(managedBootstrap);
        if (!cancelled) {
          setLifecycleError(null);
          setReadyLifecycle({ client, bootstrap: managedBootstrap });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const normalized = normalizeLifecycleError(error);
        setReadyLifecycle(null);
        setLifecycleError(normalized);
        if (!errorAlreadyReported) {
          reportLifecycleError(normalized, failureCode);
          const pendingStop = pendingStopRef.current;
          if (pendingStop?.error === normalized) pendingStop.reported = true;
        }
      });
    lifecycleQueueRef.current = startTask.then(
      () => undefined,
      () => undefined,
    );

    return () => {
      cancelled = true;
      const stopTask = lifecycleQueueRef.current.then(async () => {
        if (!startAttempted) return;

        const pendingStop: PendingManagedStop = {
          client,
          reported: false,
        };
        pendingStopRef.current = pendingStop;
        try {
          await client.stop();
          if (pendingStopRef.current === pendingStop) {
            pendingStopRef.current = null;
          }
        } catch (error) {
          const normalized = normalizeLifecycleError(error);
          pendingStop.error = normalized;
          pendingStop.reported = true;
          reportLifecycleError(normalized, "chat-client-stop-failed");
          throw normalized;
        }
      });
      lifecycleQueueRef.current = stopTask.catch(() => undefined);
    };
  }, [client, managedBootstrap, reportLifecycleError, retryVersion]);

  const ctx = useMemo(() => ({ client, host }), [client, host]);
  const lifecycleReady =
    !managedBootstrap ||
    (readyLifecycle?.client === client &&
      readyLifecycle.bootstrap === managedBootstrap);
  const renderedChildren = lifecycleReady
    ? children
    : lifecycleError && lifecycleFallback
      ? typeof lifecycleFallback === "function"
        ? lifecycleFallback({ error: lifecycleError, retry: retryLifecycle })
        : lifecycleFallback
      : null;

  return (
    <ChatContext.Provider value={ctx}>
      <ChatHostContext.Provider value={host}>
        {renderedChildren}
      </ChatHostContext.Provider>
    </ChatContext.Provider>
  );
}
