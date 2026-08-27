import React, { useEffect, useMemo, useRef, useState } from "react";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import { Check, Copy, Send } from "lucide-react";
import { t } from "../../i18n";
import { useI18n } from "../../i18n";
import WKApp from "../../App";
import APIClient from "../../Service/APIClient";
import { forwardPlainText } from "../../Service/ForwardService";
import { copyToClipboard } from "../../Utils/clipboard";
import { Dap } from "../../Service/Dap";
import WKButton from "../WKButton";
import "./index.css";

/**
 * A reusable "copy prompt / forward to Bot" action block.
 *
 * WHY this exists: several marketplace flows (MCP 上架, 专家 / 专家团 上架, and future
 * ones) render a generated prompt the user hands to an Agent. Historically each modal
 * only offered "复制提示词". This block adds the second half — pick one of your owned
 * Bots and forward the prompt straight into that Bot's DM — as ONE shared component so
 * every "复制提示词" surface gets the same behaviour without re-implementing bot
 * selection / sending. Modeled on the docs "新建 HTML" flow (owned-bot radio list +
 * send), but self-contained: the host modal just drops <PromptForwardActions/> into its
 * body and passes the prompt + space id.
 *
 * SECURITY: this component never touches a Bot Token. Forwarding sends the prompt as a
 * normal chat message to the Bot's Person channel; the Bot runs with its own runtime
 * credentials. The prompt text is authored by the caller (already carries the
 * authoritative Space ID / API base URL) and is delivered verbatim.
 */
export interface PromptForwardActionsProps {
  /** The prompt text to copy / forward. Actions are disabled while empty. */
  prompt: string;
  /**
   * Space to fetch owned Bots from and to stamp on the forwarded DM. Falls back to
   * WKApp.shared.currentSpaceId when omitted.
   */
  spaceId?: string;
  /** Force-disable both actions (e.g. the prompt isn't ready yet). */
  disabled?: boolean;
  /** Optional hint line rendered above the buttons (e.g. Skill prerequisite). */
  prerequisiteHint?: string;
  /** After a successful forward — the host typically closes its modal here. */
  onForwarded?: (botUid: string) => void;
  /** Jump into the Bot conversation after sending (default true). */
  navigateOnSend?: boolean;
  /**
   * "stack" (default): bot picker + both buttons in one vertical column — the
   * shared layout every existing caller uses.
   * "split": two columns — left shows `preview` (the generated prompt) with the
   * copy button beneath it, right shows the bot picker (fills the height) with
   * the forward button beneath it. The host sizes the outer box.
   */
  layout?: "stack" | "split";
  /** Left-column content in split layout (usually the prompt <pre> + hint). */
  preview?: React.ReactNode;
  /**
   * DAP event to emit once on a SUCCESSFUL copy. Each host supplies its own
   * (e.g. "market_bot_publish_prompt_copied", "market_skill_install_prompt_copied",
   * "market_mcp_connect_prompt_copied") so the metric follows the surface, not
   * the route. Omit to emit nothing (e.g. the expert/squad publish surface,
   * whose copy is not counted). See DAP_EVENTS.md.
   */
  copyTrackEvent?: string;
}

/** One owned-Bot row the picker renders. Sourced from `/robot/owned_bots`. */
interface OwnedBot {
  uid: string;
  name: string;
  description?: string;
}

type BotsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; bots: OwnedBot[] };

/**
 * Bots the current user OWNS in a space (server enforces owner + space + active). Mirrors
 * the docs picker source so "转发给 Bot" only offers Bots the user can actually task.
 */
async function fetchOwnedBots(spaceId: string): Promise<OwnedBot[]> {
  if (!spaceId) return [];
  const data = await APIClient.shared.get<Array<Partial<OwnedBot>>>(
    "/robot/owned_bots",
    { param: { space_id: spaceId } }
  );
  if (!Array.isArray(data)) return [];
  return data
    .filter((b): b is OwnedBot => !!b && typeof b.uid === "string" && !!b.uid)
    .map((b) => {
      const lite: OwnedBot = { uid: b.uid, name: b.name || b.uid };
      if (b.description) lite.description = b.description;
      return lite;
    });
}

// Monotonic source for per-instance radio group names (see radioGroupName below).
let radioGroupNameSeq = 0;

export default function PromptForwardActions({
  prompt,
  spaceId,
  disabled,
  prerequisiteHint,
  onForwarded,
  navigateOnSend = true,
  layout = "stack",
  preview,
  copyTrackEvent,
}: PromptForwardActionsProps) {
  useI18n();
  // INVARIANT: this snapshot does NOT subscribe to space changes. Every current
  // host closes its modal on the `space-changed` bus event (Expert/MCP publish
  // modals), so a stale Space here is unreachable today. A future caller that
  // keeps this mounted across a Space switch must remount it (e.g. key it by
  // Space) — otherwise the forward would target the previous Space's bot.
  const effectiveSpaceId = useMemo(
    () => spaceId || WKApp.shared?.currentSpaceId || "",
    [spaceId]
  );
  const [bots, setBots] = useState<BotsState>({ kind: "loading" });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  // A successful forward typically unmounts this component mid-handler (the
  // host closes its modal from onForwarded / showConversation), and the
  // copied-toast reset timer can outlive a fast close. Guard both so React 17
  // doesn't warn about setState on an unmounted component.
  const mountedRef = useRef(true);
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);
  // Per-instance radio group name: this is a shared @octo/base component, and a
  // hardcoded name would merge two simultaneously-mounted pickers into one
  // radio group (state/DOM desync). No caller does that today, but a unique
  // name makes it impossible rather than merely unexercised. Module counter
  // via useState initializer (React 17 here — no useId), stable per mount.
  const [radioGroupName] = useState(
    () => `wk-prompt-forward-bot-${++radioGroupNameSeq}`
  );

  useEffect(() => {
    let active = true;
    setBots({ kind: "loading" });
    setSelectedUid(null);
    if (!effectiveSpaceId) {
      setBots({ kind: "ready", bots: [] });
      return;
    }
    void fetchOwnedBots(effectiveSpaceId)
      .then((list) => {
        if (!active) return;
        setBots({ kind: "ready", bots: list });
        setSelectedUid(list.length > 0 ? list[0].uid : null);
      })
      .catch(() => {
        if (active) setBots({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [effectiveSpaceId, reloadKey]);

  const promptReady = Boolean(prompt) && !disabled;
  const hasBots = bots.kind === "ready" && bots.bots.length > 0;
  const canForward = promptReady && hasBots && !!selectedUid && !forwarding;

  const handleCopy = async () => {
    if (!promptReady) return;
    const ok = await copyToClipboard(prompt);
    if (ok) {
      if (!mountedRef.current) return;
      setCopied(true);
      // Emit the caller-supplied copy event once on SUCCESS (not on click):
      // copyToClipboard can return false in a non-secure context / on a
      // permission denial, and that must not be counted. Each host passes the
      // event for its own surface (bot-publish / skill-install / mcp-connect),
      // so the metric follows the surface rather than a brittle route match.
      // Surfaces whose copy is not counted (expert/squad publish) pass none.
      if (copyTrackEvent) {
        Dap.shared.track(copyTrackEvent, {});
      }
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        if (mountedRef.current) setCopied(false);
      }, 2000);
    } else {
      Toast.error(t("base.promptForward.copyFailed"));
    }
  };

  const handleForward = async () => {
    if (!canForward || bots.kind !== "ready") return;
    const bot = bots.bots.find((b: OwnedBot) => b.uid === selectedUid);
    if (!bot) return;
    const channel = new Channel(bot.uid, ChannelTypePerson);
    setForwarding(true);
    try {
      const result = await forwardPlainText([channel], prompt, {
        spaceId: effectiveSpaceId || null,
      });
      if (result.failedTargets > 0) {
        Toast.error(t("base.promptForward.forwardFailed"));
        return;
      }
      Toast.success(
        t("base.promptForward.forwardSuccess", { values: { name: bot.name } })
      );
      if (navigateOnSend) WKApp.endpoints.showConversation(channel);
      onForwarded?.(bot.uid);
    } catch {
      Toast.error(t("base.promptForward.forwardFailed"));
    } finally {
      if (mountedRef.current) setForwarding(false);
    }
  };

  const botPicker = (
    <div className="wk-prompt-forward__bots">
      <span className="wk-prompt-forward__label">
        {t("base.promptForward.selectBot")}
      </span>
      {bots.kind === "loading" && (
        <p className="wk-prompt-forward__hint">
          {t("base.promptForward.botLoading")}
        </p>
      )}
      {bots.kind === "error" && (
        <div className="wk-prompt-forward__inline-error" role="alert">
          <span>{t("base.promptForward.botError")}</span>
          <button
            type="button"
            className="wk-prompt-forward__retry"
            onClick={() => setReloadKey((n: number) => n + 1)}
          >
            {t("base.promptForward.retry")}
          </button>
        </div>
      )}
      {bots.kind === "ready" && !hasBots && (
        <p className="wk-prompt-forward__hint" role="note">
          {t("base.promptForward.botEmpty")}
        </p>
      )}
      {bots.kind === "ready" && hasBots && (
        <ul className="wk-prompt-forward__list">
          {bots.bots.map((b: OwnedBot) => (
            <li key={b.uid}>
              <label className="wk-prompt-forward__item">
                <input
                  type="radio"
                  name={radioGroupName}
                  value={b.uid}
                  checked={selectedUid === b.uid}
                  onChange={() => setSelectedUid(b.uid)}
                />
                <span className="wk-prompt-forward__item-text">
                  <span className="wk-prompt-forward__item-name">{b.name}</span>
                  {b.description && (
                    <span className="wk-prompt-forward__item-desc">
                      {b.description}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const copyButton = (
    <WKButton
      data-testid="mcp-bot-publish-copy"
      variant="secondary"
      icon={copied ? <Check size={15} /> : <Copy size={15} />}
      onClick={handleCopy}
      disabled={!promptReady}
    >
      {copied
        ? t("base.promptForward.copied")
        : t("base.promptForward.copyPrompt")}
    </WKButton>
  );

  const forwardButton = (
    <WKButton
      variant="primary"
      icon={<Send size={15} />}
      onClick={handleForward}
      disabled={!canForward}
      loading={forwarding}
    >
      {forwarding
        ? t("base.promptForward.forwarding")
        : t("base.promptForward.forwardToBot")}
    </WKButton>
  );

  if (layout === "split") {
    return (
      <div className="wk-prompt-forward wk-prompt-forward--split">
        <div className="wk-prompt-forward__col wk-prompt-forward__col--preview">
          <div className="wk-prompt-forward__preview-body">{preview}</div>
          <div className="wk-prompt-forward__actions">{copyButton}</div>
        </div>
        <div className="wk-prompt-forward__col wk-prompt-forward__col--bots">
          {botPicker}
          {prerequisiteHint && (
            <p className="wk-prompt-forward__prereq">{prerequisiteHint}</p>
          )}
          <div className="wk-prompt-forward__actions">{forwardButton}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="wk-prompt-forward">
      {botPicker}

      {prerequisiteHint && (
        <p className="wk-prompt-forward__prereq">{prerequisiteHint}</p>
      )}

      <div className="wk-prompt-forward__actions">
        {copyButton}
        {forwardButton}
      </div>
    </div>
  );
}
