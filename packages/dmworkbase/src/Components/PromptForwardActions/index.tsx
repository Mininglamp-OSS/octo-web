import React, { useEffect, useMemo, useState } from "react";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { Toast } from "@douyinfe/semi-ui";
import { Check, Copy, Send } from "lucide-react";
import { t } from "../../i18n";
import { useI18n } from "../../i18n";
import WKApp from "../../App";
import APIClient from "../../Service/APIClient";
import { forwardPlainText } from "../../Service/ForwardService";
import { copyToClipboard } from "../../Utils/clipboard";
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

export default function PromptForwardActions({
  prompt,
  spaceId,
  disabled,
  prerequisiteHint,
  onForwarded,
  navigateOnSend = true,
  layout = "stack",
  preview,
}: PromptForwardActionsProps) {
  useI18n();
  const effectiveSpaceId = useMemo(
    () => spaceId || WKApp.shared?.currentSpaceId || "",
    [spaceId]
  );
  const [bots, setBots] = useState<BotsState>({ kind: "loading" });
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [forwarding, setForwarding] = useState(false);

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
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
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
      setForwarding(false);
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
                  name="wk-prompt-forward-bot"
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
