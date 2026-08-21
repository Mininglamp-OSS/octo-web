import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserService, WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import { getErrorMessage } from "../utils";
import type { AgentMailbox, Mailbox } from "./types";
import { resolveAgentMailboxBotNames } from "./agentIdentity";
import {
  getAgentMailboxContext,
  readRememberedAgentMailbox,
  replaceAgentMailboxContext,
  requestAgentMailboxSwitch,
  useAgentMailboxContext,
} from "./mailboxContext";

interface RefreshRequest {
  revision: number;
  silent: boolean;
}

function useSilentRefreshFlag(
  request: RefreshRequest,
  foregroundKey: unknown
): boolean {
  const previousRef = useRef<{
    revision: number;
    foregroundKey: unknown;
    silent: boolean;
  }>();
  const previous = previousRef.current;
  let silent = previous?.silent ?? false;

  if (previous && !Object.is(previous.foregroundKey, foregroundKey)) {
    silent = false;
  } else if (!previous || previous.revision !== request.revision) {
    silent = request.silent;
  }

  previousRef.current = {
    revision: request.revision,
    foregroundKey,
    silent,
  };
  return silent;
}

export default function useMailNavigation(fallbackError: string) {
  const context = useAgentMailboxContext();
  const [agentMailboxes, setAgentMailboxes] = useState<AgentMailbox[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshRequest, setRefreshRequest] = useState<RefreshRequest>({
    revision: 0,
    silent: false,
  });
  const accountRequestRef = useRef(0);
  const mailboxRequestRef = useRef(0);
  const foregroundRequestCountRef = useRef(0);
  const pendingForegroundRefreshRef = useRef(false);
  const reload = useCallback(() => {
    pendingForegroundRefreshRef.current = true;
    setRefreshRequest((current) => ({
      revision: current.revision + 1,
      silent: false,
    }));
  }, []);
  const refreshSilently = useCallback(() => {
    const silent =
      foregroundRequestCountRef.current === 0 &&
      !pendingForegroundRefreshRef.current;
    setRefreshRequest((current) => ({
      revision: current.revision + 1,
      silent,
    }));
  }, []);
  const beginForegroundRequest = useCallback((silent: boolean) => {
    if (silent) return () => undefined;
    foregroundRequestCountRef.current += 1;
    pendingForegroundRefreshRef.current = false;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      foregroundRequestCountRef.current = Math.max(
        0,
        foregroundRequestCountRef.current - 1
      );
    };
  }, []);
  const spaceId = WKApp.shared.currentSpaceId || "";
  const accountRefreshSilent = useSilentRefreshFlag(
    refreshRequest,
    `${spaceId}\u0000${fallbackError}`
  );
  const mailboxRefreshSilent = useSilentRefreshFlag(
    refreshRequest,
    `${spaceId}\u0000${context?.mailbox.id || ""}\u0000${fallbackError}`
  );

  useEffect(() => {
    let active = true;
    const finishForegroundRequest =
      beginForegroundRequest(accountRefreshSilent);
    const request = ++accountRequestRef.current;
    if (!accountRefreshSilent) {
      setLoading(true);
      setError("");
    }
    void MailService.listAgentMailboxes()
      .then(async (nextMailboxes) => {
        if (!active || request !== accountRequestRef.current) return;
        const resolvedMailboxes = await resolveAgentMailboxBotNames(
          nextMailboxes,
          (botId) => UserService.getUserProfile(botId)
        );
        if (!active || request !== accountRequestRef.current) return;
        setAgentMailboxes(resolvedMailboxes);
        const liveContext = getAgentMailboxContext();
        const current =
          liveContext?.spaceId === spaceId
            ? resolvedMailboxes.find(
                (mailbox) => mailbox.id === liveContext.mailbox.id
              )
            : undefined;
        const rememberedId = readRememberedAgentMailbox(spaceId);
        const selected =
          current ||
          resolvedMailboxes.find((mailbox) => mailbox.id === rememberedId) ||
          resolvedMailboxes[0];
        replaceAgentMailboxContext(
          selected ? { spaceId, mailbox: selected } : null
        );
        if (!selected) setLoading(false);
      })
      .catch((reason) => {
        if (!active || request !== accountRequestRef.current) return;
        if (accountRefreshSilent) return;
        setAgentMailboxes([]);
        replaceAgentMailboxContext(null);
        setError(getErrorMessage(reason, fallbackError));
        setLoading(false);
      })
      .finally(() => {
        finishForegroundRequest();
      });
    return () => {
      active = false;
      finishForegroundRequest();
    };
    // Context metadata is reconciled from the server response using the live
    // snapshot; changing it must not restart the account-list request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountRefreshSilent,
    beginForegroundRequest,
    fallbackError,
    refreshRequest.revision,
    spaceId,
  ]);

  useEffect(() => {
    if (!context || context.spaceId !== spaceId) {
      setMailboxes([]);
      // The account-list effect owns loading while it resolves or reports an
      // error. Avoid reading stale account/error state from this mailbox-only
      // effect when no mailbox context exists yet.
      return;
    }

    let active = true;
    const finishForegroundRequest =
      beginForegroundRequest(mailboxRefreshSilent);
    const request = ++mailboxRequestRef.current;
    if (!mailboxRefreshSilent) {
      setLoading(true);
      setError("");
    }
    void MailService.listMailboxes(context.mailbox.id)
      .then((nextMailboxes) => {
        if (!active || request !== mailboxRequestRef.current) return;
        setMailboxes(nextMailboxes);
        if (mailboxRefreshSilent) setError("");
      })
      .catch((reason) => {
        if (!active || request !== mailboxRequestRef.current) return;
        if (mailboxRefreshSilent) return;
        setMailboxes([]);
        setError(getErrorMessage(reason, fallbackError));
      })
      .finally(() => {
        if (
          active &&
          request === mailboxRequestRef.current &&
          !mailboxRefreshSilent
        ) {
          setLoading(false);
        }
        finishForegroundRequest();
      });
    return () => {
      active = false;
      finishForegroundRequest();
    };
  }, [
    beginForegroundRequest,
    context,
    fallbackError,
    mailboxRefreshSilent,
    refreshRequest.revision,
    spaceId,
  ]);

  useEffect(() => {
    const handleSpaceChanged = () => {
      accountRequestRef.current += 1;
      mailboxRequestRef.current += 1;
      setAgentMailboxes([]);
      setMailboxes([]);
      setLoading(true);
      setError("");
      replaceAgentMailboxContext(null);
      reload();
    };
    WKApp.mittBus.on("mail-refresh" as never, reload);
    WKApp.mittBus.on("space-changed", handleSpaceChanged);
    return () => {
      WKApp.mittBus.off("mail-refresh" as never, reload);
      WKApp.mittBus.off("space-changed", handleSpaceChanged);
    };
  }, [reload]);

  useEffect(() => {
    let inactive = document.visibilityState === "hidden";
    const markInactive = () => {
      inactive = true;
    };
    const reloadAfterReturning = () => {
      if (!inactive || document.visibilityState === "hidden") return;
      inactive = false;
      refreshSilently();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markInactive();
        return;
      }
      reloadAfterReturning();
    };

    window.addEventListener("blur", markInactive);
    window.addEventListener("focus", reloadAfterReturning);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", markInactive);
      window.removeEventListener("focus", reloadAfterReturning);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshSilently]);

  const selectAgentMailbox = useCallback(
    (mailbox: AgentMailbox, afterSwitch?: () => void) => {
      const selected = requestAgentMailboxSwitch(
        { spaceId, mailbox },
        afterSwitch
      );
      return selected;
    },
    [spaceId]
  );

  const selectedAgentMailbox =
    context?.spaceId === spaceId ? context.mailbox : null;
  const identity = useMemo(
    () =>
      selectedAgentMailbox ? { address: selectedAgentMailbox.address } : null,
    [selectedAgentMailbox]
  );

  return {
    agentMailboxes,
    selectedAgentMailbox,
    selectAgentMailbox,
    mailboxes,
    identity,
    identityUnavailable: !loading && !selectedAgentMailbox,
    loading,
    error,
    reload,
  };
}
