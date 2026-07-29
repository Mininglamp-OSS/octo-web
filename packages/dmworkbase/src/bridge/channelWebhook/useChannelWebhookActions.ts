import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "wukongimjssdk";

import {
  IncomingWebhook,
  IncomingWebhookCreateResp,
  IncomingWebhookService,
  IncomingWebhookStatus,
  canTestWebhook,
} from "../../Service/IncomingWebhook";

const TEST_COOLDOWN_MS = 3000;

export interface ChannelWebhookActionsRuntime {
  updateStatus(
    groupNo: string,
    webhookId: string,
    enabled: boolean,
    threadShortId?: string
  ): Promise<IncomingWebhook>;
  test(
    groupNo: string,
    webhookId: string,
    threadShortId?: string
  ): Promise<void>;
  regenerate(
    groupNo: string,
    webhookId: string,
    threadShortId?: string
  ): Promise<IncomingWebhookCreateResp>;
  delete(
    groupNo: string,
    webhookId: string,
    threadShortId?: string
  ): Promise<void>;
}

export type ChannelWebhookRegenerateResult =
  | { ok: true; response: IncomingWebhookCreateResp; stale?: boolean }
  | { ok: false; reason: "stale" };

export type ChannelWebhookDeleteResult =
  | { ok: true; stale?: boolean }
  | { ok: false; reason: "stale" };

function defaultActionsRuntime(): ChannelWebhookActionsRuntime {
  return {
    updateStatus(groupNo, webhookId, enabled, threadShortId) {
      return IncomingWebhookService.update(
        groupNo,
        webhookId,
        {
          status: enabled
            ? IncomingWebhookStatus.enabled
            : IncomingWebhookStatus.disabled,
        },
        threadShortId
      );
    },
    test(groupNo, webhookId, threadShortId) {
      return IncomingWebhookService.test(groupNo, webhookId, threadShortId);
    },
    regenerate(groupNo, webhookId, threadShortId) {
      return IncomingWebhookService.regenerate(
        groupNo,
        webhookId,
        threadShortId
      );
    },
    delete(groupNo, webhookId, threadShortId) {
      return IncomingWebhookService.delete(groupNo, webhookId, threadShortId);
    },
  };
}

function runtimeOrDefault(runtime?: ChannelWebhookActionsRuntime) {
  return runtime ?? defaultActionsRuntime();
}

export function useChannelWebhookActions(params: {
  channel: Channel;
  threadShortId?: string;
  reload: (options?: { silentError?: boolean }) => void | Promise<void>;
  runtime?: ChannelWebhookActionsRuntime;
}) {
  const runtime = useMemo(
    () => runtimeOrDefault(params.runtime),
    [params.runtime]
  );
  const [testingId, setTestingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [coolingTestId, setCoolingTestId] = useState<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const scopeKey = `${params.channel.channelID}:${
    params.threadShortId || "group"
  }`;
  const scopeKeyRef = useRef(scopeKey);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    scopeKeyRef.current = scopeKey;
    setTestingId(null);
    setTogglingId(null);
    setCoolingTestId(null);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  }, [scopeKey]);

  const isCurrentScope = useCallback(
    (actionScopeKey: string) =>
      mountedRef.current && scopeKeyRef.current === actionScopeKey,
    []
  );

  const refreshIfCurrentScope = useCallback(
    (actionScopeKey: string) => {
      if (!isCurrentScope(actionScopeKey)) return false;
      try {
        void Promise.resolve(params.reload({ silentError: true })).catch(() => {
          // Refresh is best-effort; it must not replace a successful mutation.
        });
      } catch {
        // Same rule for synchronous reload implementations.
      }
      return true;
    },
    [isCurrentScope, params.reload]
  );

  const toggleWebhook = useCallback(
    async (item: IncomingWebhook, enabled: boolean) => {
      if (togglingId) return false;
      const actionScopeKey = scopeKey;
      setTogglingId(item.webhook_id);
      try {
        await runtime.updateStatus(
          params.channel.channelID,
          item.webhook_id,
          enabled,
          params.threadShortId
        );
        return refreshIfCurrentScope(actionScopeKey);
      } catch (error) {
        if (!isCurrentScope(actionScopeKey)) {
          return false;
        }
        throw error;
      } finally {
        if (isCurrentScope(actionScopeKey)) {
          setTogglingId(null);
        }
      }
    },
    [
      togglingId,
      scopeKey,
      runtime,
      params.channel.channelID,
      params.threadShortId,
      refreshIfCurrentScope,
      isCurrentScope,
    ]
  );

  const testWebhook = useCallback(
    async (item: IncomingWebhook) => {
      if (!canTestWebhook(item)) return false;
      if (togglingId === item.webhook_id) return false;
      if (testingId || coolingTestId === item.webhook_id) return false;

      const actionScopeKey = scopeKey;
      setTestingId(item.webhook_id);
      try {
        await runtime.test(
          params.channel.channelID,
          item.webhook_id,
          params.threadShortId
        );
        return isCurrentScope(actionScopeKey);
      } catch (error) {
        if (!isCurrentScope(actionScopeKey)) {
          return false;
        }
        throw error;
      } finally {
        if (isCurrentScope(actionScopeKey)) {
          setTestingId(null);
          setCoolingTestId(item.webhook_id);
          if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
          cooldownTimerRef.current = setTimeout(() => {
            if (isCurrentScope(actionScopeKey)) {
              setCoolingTestId(null);
            }
          }, TEST_COOLDOWN_MS);
        }
      }
    },
    [
      coolingTestId,
      isCurrentScope,
      params.channel.channelID,
      params.threadShortId,
      runtime,
      scopeKey,
      testingId,
      togglingId,
    ]
  );

  const regenerateWebhook = useCallback(
    async (item: IncomingWebhook): Promise<ChannelWebhookRegenerateResult> => {
      const actionScopeKey = scopeKey;
      let response: IncomingWebhookCreateResp;
      try {
        response = await runtime.regenerate(
          params.channel.channelID,
          item.webhook_id,
          params.threadShortId
        );
      } catch (error) {
        if (!isCurrentScope(actionScopeKey)) {
          return { ok: false, reason: "stale" };
        }
        throw error;
      }
      const refreshed = refreshIfCurrentScope(actionScopeKey);
      return refreshed
        ? { ok: true, response }
        : { ok: true, response, stale: true };
    },
    [
      isCurrentScope,
      params.channel.channelID,
      params.threadShortId,
      refreshIfCurrentScope,
      runtime,
      scopeKey,
    ]
  );

  const deleteWebhook = useCallback(
    async (item: IncomingWebhook): Promise<ChannelWebhookDeleteResult> => {
      const actionScopeKey = scopeKey;
      try {
        await runtime.delete(
          params.channel.channelID,
          item.webhook_id,
          params.threadShortId
        );
      } catch (error) {
        if (!isCurrentScope(actionScopeKey)) {
          return { ok: false, reason: "stale" };
        }
        throw error;
      }
      const refreshed = refreshIfCurrentScope(actionScopeKey);
      return refreshed ? { ok: true } : { ok: true, stale: true };
    },
    [
      isCurrentScope,
      params.channel.channelID,
      params.threadShortId,
      refreshIfCurrentScope,
      runtime,
      scopeKey,
    ]
  );

  return {
    testingId,
    togglingId,
    coolingTestId,
    toggleWebhook,
    testWebhook,
    regenerateWebhook,
    deleteWebhook,
  };
}
