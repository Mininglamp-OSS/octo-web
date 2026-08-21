import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Bot, CheckCircle2, Mail, ShieldCheck } from "lucide-react";
import { SpaceService, useI18n, UserService, WKApp } from "@octo/base";
import MailService from "../Service/MailService";
import type {
  AgentAuthorizationView,
  AgentOutboundMode,
} from "../bridge/types";
import { getErrorMessage } from "../utils";
import {
  clearPendingMailAuthorizeSearch,
  claimMailAuthorizationRecoveryAttempt,
  clearMailAuthorizationRecoveryAttempt,
  getMailAuthorizationSessionStorage,
  isMailAuthorizationAuthenticationError,
  mailAuthorizeCode,
  mailAuthorizeMailbox,
  mailAuthorizeSpaceId,
  notifyMailAuthorizationResolved,
  stripMailAuthorizeCodeFromUrl,
} from "../authorizationSession";
import { resolveBotDisplayName } from "../bridge/agentIdentity";
import {
  authorizationPollIntervalMs,
  authorizationPhase,
  isAuthorizationExpired,
  type MailAuthorizationPhase,
} from "./authorizationFlow";
import { isTransientMailPollError } from "../bridge/polling";
import "../ui/MailAuthorizationPage/index.css";

interface MailAuthorizationPageProps {
  initialSearch?: string;
  onSessionExpired?: () => void;
}

export default function MailAuthorizationPage({
  initialSearch = window.location.search,
  onSessionExpired,
}: MailAuthorizationPageProps) {
  const { t } = useI18n();
  const code = useMemo(() => mailAuthorizeCode(initialSearch), [initialSearch]);
  const requestedMailbox = useMemo(
    () => mailAuthorizeMailbox(initialSearch),
    [initialSearch]
  );
  const spaceId = useMemo(
    () => mailAuthorizeSpaceId(initialSearch),
    [initialSearch]
  );
  const currentSpaceId = (WKApp.shared.currentSpaceId || "").trim();
  const [authorization, setAuthorization] =
    useState<AgentAuthorizationView | null>(null);
  const authorizationRequestRef = useRef<
    AgentAuthorizationView["request"] | undefined
  >(undefined);
  const [mailboxId, setMailboxId] = useState("");
  const [outboundMode, setOutboundMode] = useState<AgentOutboundMode>(
    "manual_confirmation"
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<MailAuthorizationPhase>("approval");
  const [error, setError] = useState("");
  const [botDisplayName, setBotDisplayName] = useState("");
  const [targetSpaceName, setTargetSpaceName] = useState("");
  const [currentSpaceName, setCurrentSpaceName] = useState("");
  const [spaceMismatchConfirmed, setSpaceMismatchConfirmed] = useState(false);
  const preserveForLoginRef = useRef(false);
  const sessionExpirationHandledRef = useRef(false);
  const authorizationResolvedRef = useRef(false);
  const unmountCleanupGenerationRef = useRef(0);
  const resolveAuthorizationSession = useCallback(() => {
    if (authorizationResolvedRef.current) return;
    authorizationResolvedRef.current = true;
    clearPendingMailAuthorizeSearch(getMailAuthorizationSessionStorage());
    notifyMailAuthorizationResolved();
  }, []);
  const recoverExpiredSession = useCallback(() => {
    if (!onSessionExpired) return false;
    if (sessionExpirationHandledRef.current) return true;
    if (
      !claimMailAuthorizationRecoveryAttempt(
        code,
        getMailAuthorizationSessionStorage()
      )
    ) {
      return false;
    }
    preserveForLoginRef.current = true;
    sessionExpirationHandledRef.current = true;
    onSessionExpired();
    return true;
  }, [code, onSessionExpired]);

  useEffect(() => {
    stripMailAuthorizeCodeFromUrl();
  }, []);

  useEffect(() => {
    if (!spaceId) {
      setTargetSpaceName("");
      setCurrentSpaceName("");
      return;
    }
    let active = true;
    void SpaceService.shared
      .getMySpaces({ suppressAuthExpiredLogout: true })
      .then((spaces) => {
        if (!active) return;
        const target = spaces.find((space) => space.space_id === spaceId);
        const current = spaces.find(
          (space) => space.space_id === currentSpaceId
        );
        setTargetSpaceName((target?.name || "").trim());
        setCurrentSpaceName((current?.name || "").trim());
      })
      .catch(() => {
        if (active) {
          setTargetSpaceName("");
          setCurrentSpaceName("");
        }
      });
    return () => {
      active = false;
    };
  }, [currentSpaceId, spaceId]);

  useEffect(() => {
    const generation = ++unmountCleanupGenerationRef.current;
    return () => {
      // React 18 StrictMode immediately cleans up and re-runs effects once in
      // development. Defer the destructive cleanup so the matching re-mount
      // can invalidate it; a real unmount has no later generation and still
      // clears the one-time authorization return state.
      queueMicrotask(() => {
        if (unmountCleanupGenerationRef.current !== generation) return;
        if (!preserveForLoginRef.current) resolveAuthorizationSession();
      });
    };
  }, [resolveAuthorizationSession]);

  useEffect(() => {
    let active = true;
    if (!code || !spaceId) {
      resolveAuthorizationSession();
      setError(
        !spaceId
          ? t("mail.authorization.missingSpace")
          : t("mail.authorization.invalidCode")
      );
      setLoading(false);
      return;
    }
    void MailService.getAgentAuthorization(code, spaceId)
      .then((result) => {
        if (!active) return;
        clearMailAuthorizationRecoveryAttempt(
          code,
          getMailAuthorizationSessionStorage()
        );
        authorizationRequestRef.current = result.request;
        setAuthorization(result);
        setOutboundMode("manual_confirmation");
        if (isAuthorizationExpired(result.request)) {
          setPhase("failed");
          setError(t("mail.authorization.expired"));
          resolveAuthorizationSession();
          return;
        }
        const nextPhase = authorizationPhase(result.request.status);
        setPhase(nextPhase);
        if (nextPhase === "failed") {
          setError(t("mail.authorization.connectionFailed"));
          resolveAuthorizationSession();
        } else if (nextPhase === "connected") {
          resolveAuthorizationSession();
        }
        const requested = requestedMailbox.toLowerCase();
        const match = requested
          ? result.mailboxes.find(
              (mailbox) => mailbox.address.toLowerCase() === requested
            )
          : undefined;
        setMailboxId(
          requested ? match?.id ?? "" : result.mailboxes[0]?.id ?? ""
        );
        if (requested && !match) {
          setError(
            t("mail.authorization.targetNotFound", {
              values: { address: requestedMailbox },
            })
          );
          resolveAuthorizationSession();
        }
      })
      .catch((reason) => {
        if (active) {
          if (
            isMailAuthorizationAuthenticationError(reason) &&
            recoverExpiredSession()
          ) {
            return;
          }
          resolveAuthorizationSession();
          setError(getErrorMessage(reason, t("mail.authorization.loadFailed")));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    code,
    recoverExpiredSession,
    requestedMailbox,
    resolveAuthorizationSession,
    spaceId,
    t,
  ]);

  useEffect(() => {
    const request = authorization?.request;
    if (!request?.botId) {
      setBotDisplayName("");
      return;
    }
    let active = true;
    void resolveBotDisplayName(
      request.botId,
      request.botProfile || request.botId,
      (botId) =>
        UserService.getUserProfile(botId, undefined, {
          suppressAuthExpiredLogout: true,
        })
    ).then((name) => {
      if (active) setBotDisplayName(name);
    });
    return () => {
      active = false;
    };
  }, [authorization?.request]);

  useEffect(() => {
    if (!code || !spaceId || phase !== "connecting") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let transientFailures = 0;
    let latestRequest = authorizationRequestRef.current;

    const poll = async () => {
      if (latestRequest && isAuthorizationExpired(latestRequest)) {
        setPhase("failed");
        setError(t("mail.authorization.expired"));
        resolveAuthorizationSession();
        return;
      }
      try {
        const result = await MailService.getAgentAuthorization(code, spaceId);
        if (!active) return;
        transientFailures = 0;
        latestRequest = result.request;
        authorizationRequestRef.current = result.request;
        setAuthorization(result);
        if (isAuthorizationExpired(result.request)) {
          setPhase("failed");
          setError(t("mail.authorization.expired"));
          resolveAuthorizationSession();
          return;
        }
        const nextPhase = authorizationPhase(result.request.status);
        if (nextPhase === "connected") {
          setPhase("connected");
          resolveAuthorizationSession();
          return;
        }
        if (nextPhase === "failed") {
          setPhase("failed");
          setError(t("mail.authorization.connectionFailed"));
          resolveAuthorizationSession();
          return;
        }
        timer = setTimeout(poll, authorizationPollIntervalMs(result.request));
      } catch (reason) {
        if (!active) return;
        if (
          isMailAuthorizationAuthenticationError(reason) &&
          recoverExpiredSession()
        ) {
          return;
        }
        if (isTransientMailPollError(reason) && transientFailures < 3) {
          transientFailures += 1;
          timer = setTimeout(poll, authorizationPollIntervalMs(latestRequest));
          return;
        }
        setPhase("failed");
        setError(
          getErrorMessage(reason, t("mail.authorization.connectionFailed"))
        );
        resolveAuthorizationSession();
      }
    };

    timer = setTimeout(poll, authorizationPollIntervalMs(latestRequest));
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [
    code,
    phase,
    recoverExpiredSession,
    resolveAuthorizationSession,
    spaceId,
    t,
  ]);

  const approve = async () => {
    if (!code || !mailboxId || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const approval = await MailService.approveAgentAuthorization(
        code,
        mailboxId,
        outboundMode,
        spaceId
      );
      if (
        approval.approved !== true ||
        approval.mailboxId !== mailboxId ||
        approval.outboundMode !== outboundMode
      ) {
        setError(t("mail.authorization.approvalMismatch"));
        resolveAuthorizationSession();
        return;
      }
      setPhase("connecting");
    } catch (reason) {
      if (
        isMailAuthorizationAuthenticationError(reason) &&
        recoverExpiredSession()
      ) {
        return;
      }
      if (!isTransientMailPollError(reason)) {
        resolveAuthorizationSession();
      }
      setError(getErrorMessage(reason, t("mail.authorization.approveFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  const request = authorization?.request;
  const selectedMailbox = authorization?.mailboxes.find(
    (mailbox) => mailbox.id === mailboxId
  );
  const visibleMailboxes = requestedMailbox
    ? authorization?.mailboxes.filter(
        (mailbox) =>
          mailbox.address.toLowerCase() === requestedMailbox.toLowerCase()
      ) ?? []
    : authorization?.mailboxes ?? [];
  const connected = phase === "connected";
  const connecting = phase === "connecting";
  const spaceMismatch = Boolean(
    currentSpaceId && spaceId && currentSpaceId !== spaceId
  );

  return (
    <div className="mail-auth-page">
      <main className="mail-auth-card">
        <div className="mail-auth-card__icon" aria-hidden="true">
          {connected ? <CheckCircle2 size={28} /> : <ShieldCheck size={28} />}
        </div>
        <h1>
          {connected
            ? t("mail.authorization.connectedTitle")
            : connecting
            ? t("mail.authorization.connectingTitle")
            : t("mail.authorization.title")}
        </h1>
        <p className="mail-auth-card__description">
          {connected
            ? t("mail.authorization.connectedDescription")
            : connecting
            ? t("mail.authorization.connectingDescription")
            : t("mail.authorization.description")}
        </p>

        {phase === "approval" && request && (
          <section className="mail-auth-client">
            <Bot size={20} aria-hidden="true" />
            <div>
              <strong>{botDisplayName || request.botId}</strong>
              <span>{request.botId}</span>
            </div>
          </section>
        )}

        {phase === "approval" && request && (
          <div className="mail-auth-card__status">
            {t("mail.authorization.targetSpace", {
              values: { spaceName: targetSpaceName || spaceId },
            })}
          </div>
        )}

        {phase === "approval" && request && spaceMismatch && (
          <label className="mail-auth-space-confirmation">
            <input
              type="checkbox"
              checked={spaceMismatchConfirmed}
              onChange={(event) =>
                setSpaceMismatchConfirmed(event.target.checked)
              }
            />
            <span>
              {t("mail.authorization.spaceMismatchConfirmation", {
                values: {
                  currentSpaceName: currentSpaceName || currentSpaceId,
                  targetSpaceName: targetSpaceName || spaceId,
                },
              })}
            </span>
          </label>
        )}

        {phase === "approval" && request && (
          <div className="mail-auth-code">
            <span>{t("mail.authorization.codeLabel")}</span>
            <strong>{request.userCode}</strong>
            <small>{t("mail.authorization.codePrefilled")}</small>
          </div>
        )}

        {phase === "approval" && authorization && (
          <fieldset className="mail-auth-mailboxes">
            <legend>{t("mail.authorization.chooseMailbox")}</legend>
            {visibleMailboxes.map((mailbox) => (
              <label
                className={`mail-auth-mailbox${
                  mailbox.id === mailboxId ? " is-selected" : ""
                }`}
                key={mailbox.id}
              >
                <input
                  type="radio"
                  name="agent-mailbox"
                  value={mailbox.id}
                  checked={mailbox.id === mailboxId}
                  onChange={() => setMailboxId(mailbox.id)}
                />
                <Mail size={18} aria-hidden="true" />
                <span>
                  <strong>{mailbox.address}</strong>
                  <small>
                    {mailbox.connectState === "connected"
                      ? t("mail.authorization.rebindHint", {
                          values: {
                            agent:
                              mailbox.agentName || mailbox.botId || "Agent",
                          },
                        })
                      : t("mail.agentMailboxes.unconnected")}
                  </small>
                </span>
              </label>
            ))}
            {visibleMailboxes.length === 0 && (
              <div className="mail-auth-card__empty">
                {t("mail.authorization.noMailboxes")}
              </div>
            )}
          </fieldset>
        )}

        {phase === "approval" && authorization && (
          <fieldset className="mail-auth-mailboxes mail-auth-permissions">
            <legend>{t("mail.authorization.permissionLegend")}</legend>
            <p className="mail-auth-card__status">
              {t(
                outboundMode === "automatic_send"
                  ? "mail.authorization.selectedAutomatic"
                  : "mail.authorization.selectedManual"
              )}
            </p>
            <label
              className={`mail-auth-automation${
                outboundMode === "manual_confirmation" ? " is-selected" : ""
              }`}
            >
              <input
                type="radio"
                name="agent-mail-permission"
                value="manual-review"
                checked={outboundMode === "manual_confirmation"}
                onChange={() => setOutboundMode("manual_confirmation")}
              />
              <span>
                <strong>{t("mail.authorization.manualReviewTitle")}</strong>
                <small>{t("mail.authorization.manualReviewDescription")}</small>
              </span>
            </label>
            <label
              className={`mail-auth-automation${
                outboundMode === "automatic_send" ? " is-selected" : ""
              }`}
            >
              <input
                type="radio"
                name="agent-mail-permission"
                value="automatic-send"
                checked={outboundMode === "automatic_send"}
                onChange={() => setOutboundMode("automatic_send")}
              />
              <span>
                <strong>{t("mail.authorization.automaticSendTitle")}</strong>
                <small>
                  {t("mail.authorization.automaticSendDescription")}
                </small>
              </span>
            </label>
          </fieldset>
        )}

        {(connecting || connected) && selectedMailbox && (
          <div className="mail-auth-approved-mailbox">
            <Mail size={18} aria-hidden="true" />
            {selectedMailbox.address}
          </div>
        )}
        {connected && outboundMode === "automatic_send" && (
          <div className="mail-auth-card__status">
            {t("mail.authorization.automaticSendEnabled")}
          </div>
        )}

        {loading && (
          <div className="mail-auth-card__status">
            {t("mail.authorization.loading")}
          </div>
        )}
        {connecting && (
          <div className="mail-auth-card__status">
            {t("mail.authorization.connecting")}
          </div>
        )}
        {error && <div className="mail-auth-card__error">{error}</div>}

        {phase === "approval" && (
          <button
            className="mail-auth-card__button"
            type="button"
            disabled={
              loading ||
              submitting ||
              !mailboxId ||
              (spaceMismatch && !spaceMismatchConfirmed)
            }
            onClick={() => void approve()}
          >
            {submitting
              ? t("mail.authorization.approving")
              : t("mail.authorization.approve")}
          </button>
        )}
      </main>
    </div>
  );
}
