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

export default function useMailNavigation(fallbackError: string) {
  const context = useAgentMailboxContext();
  const [agentMailboxes, setAgentMailboxes] = useState<AgentMailbox[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const accountRequestRef = useRef(0);
  const mailboxRequestRef = useRef(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const spaceId = WKApp.shared.currentSpaceId || "";

  useEffect(() => {
    let active = true;
    const request = ++accountRequestRef.current;
    setLoading(true);
    setError("");
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
        setAgentMailboxes([]);
        replaceAgentMailboxContext(null);
        setError(getErrorMessage(reason, fallbackError));
        setLoading(false);
      });
    return () => {
      active = false;
    };
    // Context metadata is reconciled from the server response using the live
    // snapshot; changing it must not restart the account-list request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallbackError, revision, spaceId]);

  useEffect(() => {
    if (!context || context.spaceId !== spaceId) {
      setMailboxes([]);
      // The account-list effect owns loading while it resolves or reports an
      // error. Avoid reading stale account/error state from this mailbox-only
      // effect when no mailbox context exists yet.
      return;
    }

    let active = true;
    const request = ++mailboxRequestRef.current;
    setLoading(true);
    setError("");
    void MailService.listMailboxes(context.mailbox.id)
      .then((nextMailboxes) => {
        if (!active || request !== mailboxRequestRef.current) return;
        setMailboxes(nextMailboxes);
      })
      .catch((reason) => {
        if (!active || request !== mailboxRequestRef.current) return;
        setMailboxes([]);
        setError(getErrorMessage(reason, fallbackError));
      })
      .finally(() => {
        if (active && request === mailboxRequestRef.current) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [context, fallbackError, revision, spaceId]);

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
