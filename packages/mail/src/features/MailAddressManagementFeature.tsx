import React, { useCallback, useEffect, useState } from "react";
import { useI18n, UserService, WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type { AgentMailbox, AgentOutboundMode } from "../bridge/types";
import { resolveAgentMailboxBotNames } from "../bridge/agentIdentity";
import { getErrorMessage } from "../utils";
import MailAddressManagementView from "../ui/MailAddressManagementView";
import MailRuleManagementFeature from "./MailRuleManagementFeature";
import MailRecordsFeature from "./MailRecordsFeature";
import {
  getAgentMailboxContext,
  replaceAgentMailboxContext,
  requestAgentMailboxSwitch,
  useAgentMailboxContext,
} from "../bridge/mailboxContext";

type PendingConfirmation = {
  kind: "disconnect" | "delete" | "enable-automatic-send";
  mailbox: AgentMailbox;
};

export default function MailAddressManagementFeature() {
  const { t } = useI18n();
  const [mailboxes, setMailboxes] = useState<AgentMailbox[]>([]);
  const [maxMailboxes, setMaxMailboxes] = useState<number | null>(null);
  const [domain, setDomain] = useState("");
  const [localpart, setLocalpart] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [createdMailbox, setCreatedMailbox] = useState<AgentMailbox | null>(
    null
  );
  const [promptCopied, setPromptCopied] = useState(false);
  const [disconnectingId, setDisconnectingId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [updatingAutomationId, setUpdatingAutomationId] = useState("");
  const [pendingConfirmation, setPendingConfirmation] =
    useState<PendingConfirmation | null>(null);
  const [revision, setRevision] = useState(0);
  const mailboxContext = useAgentMailboxContext();

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setMaxMailboxes(null);
    void MailService.getAgentMailboxRegistrationView()
      .then(async (view) => {
        const resolvedMailboxes = await resolveAgentMailboxBotNames(
          view.mailboxes,
          UserService.getUserProfile
        );
        if (active) {
          setMailboxes(resolvedMailboxes);
          setMaxMailboxes(view.maxMailboxes);
          setDomain(view.addressDomain);
        }
      })
      .catch((reason) => {
        if (active) setError(getErrorMessage(reason, t("mail.error.fallback")));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, t]);

  const currentSpaceId = (WKApp.shared.currentSpaceId || "").trim();

  const updateCurrentMailboxContext = (
    expectedMailboxId: string,
    update: (current: AgentMailbox) => AgentMailbox | null
  ) => {
    const liveSpaceId = (WKApp.shared.currentSpaceId || "").trim();
    const liveContext = getAgentMailboxContext();
    if (
      liveSpaceId !== currentSpaceId ||
      liveContext?.spaceId !== currentSpaceId ||
      liveContext.mailbox.id !== expectedMailboxId
    ) {
      return;
    }
    const nextMailbox = update(liveContext.mailbox);
    replaceAgentMailboxContext(
      nextMailbox ? { spaceId: currentSpaceId, mailbox: nextMailbox } : null
    );
  };

  const setupPrompt = createdMailbox
    ? t("mail.agentMailboxes.setupPrompt", {
        values: { address: createdMailbox.address, spaceId: currentSpaceId },
      })
    : "";

  const create = async () => {
    if (
      !localpart.trim() ||
      !domain ||
      maxMailboxes === null ||
      submitting ||
      mailboxes.length >= maxMailboxes
    )
      return;
    setSubmitting(true);
    setActionError("");
    try {
      const mailbox = await MailService.createAgentMailbox(localpart.trim());
      setMailboxes((current) => [...current, mailbox]);
      setLocalpart("");
      setPromptCopied(false);
      setCreatedMailbox(mailbox);
      WKApp.mittBus.emit("mail-refresh" as never);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setSubmitting(false);
    }
  };

  const copy = async (mailbox: AgentMailbox) => {
    setActionError("");
    try {
      await navigator.clipboard.writeText(mailbox.address);
      setCopiedId(mailbox.id);
      window.setTimeout(() => setCopiedId(""), 1200);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    }
  };

  const copySetupPrompt = async () => {
    setActionError("");
    try {
      await navigator.clipboard.writeText(setupPrompt);
      setPromptCopied(true);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    }
  };

  const disconnect = async (mailbox: AgentMailbox) => {
    if (disconnectingId) return;
    setDisconnectingId(mailbox.id);
    setActionError("");
    try {
      await MailService.revokeAgentMailboxBinding(mailbox.id);
      const disconnectPatch = {
        botId: undefined,
        botProfile: undefined,
        agentName: undefined,
        connectState: "unconnected" as const,
      };
      setMailboxes((current) =>
        current.map((item) =>
          item.id === mailbox.id ? { ...item, ...disconnectPatch } : item
        )
      );
      updateCurrentMailboxContext(mailbox.id, (current) => ({
        ...current,
        ...disconnectPatch,
      }));
      WKApp.mittBus.emit("mail-refresh" as never);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setDisconnectingId("");
    }
  };

  const updateAutomation = async (
    mailbox: AgentMailbox,
    outboundMode: AgentOutboundMode
  ) => {
    if (updatingAutomationId || mailbox.connectState !== "connected") return;
    setUpdatingAutomationId(mailbox.id);
    setActionError("");
    try {
      const updated = await MailService.updateAgentMailboxAutomation(
        mailbox.id,
        outboundMode
      );
      const automationPatch = {
        outboundMode: updated.outboundMode,
        autoReplyEnabled: updated.autoReplyEnabled,
      };
      setMailboxes((current) =>
        current.map((item) =>
          item.id === mailbox.id ? { ...item, ...automationPatch } : item
        )
      );
      updateCurrentMailboxContext(mailbox.id, (current) => ({
        ...current,
        ...automationPatch,
      }));
      WKApp.mittBus.emit("mail-refresh" as never);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setUpdatingAutomationId("");
    }
  };

  const deleteMailbox = async (mailbox: AgentMailbox) => {
    if (deletingId || mailbox.deletable !== true) return;
    setDeletingId(mailbox.id);
    setActionError("");
    try {
      await MailService.deleteAgentMailbox(mailbox.id);
      const remaining = mailboxes.filter((item) => item.id !== mailbox.id);
      setMailboxes(remaining);
      updateCurrentMailboxContext(mailbox.id, () => remaining[0] || null);
      WKApp.mittBus.emit("mail-refresh" as never);
    } catch (reason) {
      setActionError(getErrorMessage(reason, t("mail.error.fallback")));
    } finally {
      setDeletingId("");
    }
  };

  const confirmPendingAction = () => {
    if (!pendingConfirmation) return;
    const { kind, mailbox } = pendingConfirmation;
    setPendingConfirmation(null);
    if (kind === "disconnect") {
      void disconnect(mailbox);
      return;
    }
    if (kind === "delete") {
      void deleteMailbox(mailbox);
      return;
    }
    void updateAutomation(mailbox, "automatic_send");
  };

  return (
    <MailAddressManagementView
      mailboxes={mailboxes}
      loading={loading}
      submitting={submitting}
      error={error}
      actionError={actionError}
      localpart={localpart}
      domain={domain}
      maxMailboxes={maxMailboxes}
      copiedId={copiedId}
      createdMailbox={createdMailbox}
      setupPrompt={setupPrompt}
      promptCopied={promptCopied}
      disconnectingId={disconnectingId}
      deletingId={deletingId}
      updatingAutomationId={updatingAutomationId}
      pendingConfirmation={pendingConfirmation}
      t={t}
      onLocalpartChange={setLocalpart}
      onCreate={() => void create()}
      onCopy={(mailbox) => void copy(mailbox)}
      onCopySetupPrompt={() => void copySetupPrompt()}
      onConnect={(mailbox) => {
        setPromptCopied(false);
        setCreatedMailbox(mailbox);
      }}
      onDisconnect={(mailbox) =>
        setPendingConfirmation({ kind: "disconnect", mailbox })
      }
      onDelete={(mailbox) =>
        setPendingConfirmation({ kind: "delete", mailbox })
      }
      onAutomationChange={(mailbox, outboundMode) => {
        if (outboundMode === "automatic_send") {
          setPendingConfirmation({ kind: "enable-automatic-send", mailbox });
          return;
        }
        void updateAutomation(mailbox, "manual_confirmation");
      }}
      onConfirmPendingAction={confirmPendingAction}
      onCancelPendingAction={() => setPendingConfirmation(null)}
      currentMailboxId={mailboxContext?.mailbox.id || ""}
      onSelectMailbox={(mailbox) => {
        requestAgentMailboxSwitch(
          {
            spaceId: WKApp.shared.currentSpaceId || "",
            mailbox,
          },
          () => {
            WKApp.routeRight.replaceToRoot(
              <MailRecordsFeature key={mailbox.id} initialRole="inbox" />
            );
            WKApp.mittBus.emit("mail-open-inbox" as never);
          }
        );
      }}
      onManageRules={(mailbox) =>
        WKApp.routeRight.push(<MailRuleManagementFeature mailbox={mailbox} />)
      }
      onCloseSetup={() => setCreatedMailbox(null)}
      onRefresh={reload}
    />
  );
}
