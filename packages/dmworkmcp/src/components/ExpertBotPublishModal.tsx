import React, { useMemo } from "react";
import { Bot } from "lucide-react";
import { PromptForwardModal, t, useI18n, WKApp } from "@octo/base";
import {
  getExpertBotPublishPrompt,
  resolveMcpAPIBaseURL,
} from "../utils/expertBotPublishPrompt";

interface ExpertBotPublishModalProps {
  visible: boolean;
  /** Which catalog the Bot prompt targets: single expert or a squad. */
  kind: "agent" | "squad";
  /** "create" (default) publishes a new listing; "update" edits an existing one. */
  mode?: "create" | "update";
  /** The listing id to update — required when mode="update". */
  editingId?: string;
  onClose: () => void;
  onToast: (message: string) => void;
}

/** Current Space ID, mirroring McpBotPublishModal.getCurrentSpaceId — prefer
 *  the in-memory app state, fall back to the persisted value. sanitizeSpaceId
 *  in expertBotPublishPrompt.ts guards a poisoned fallback before it reaches a
 *  shell command example. */
function getCurrentSpaceId(): string {
  return (
    WKApp.shared?.currentSpaceId ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("currentSpaceId") || ""
      : "")
  );
}

/** "Publish / update via Bot" — renders the generated prompt in the shared
 *  PromptForwardModal (copy / pick an owned Bot / forward the prompt into that
 *  Bot's DM). Prompt content lives in ../utils/expertBotPublishPrompt.ts: create
 *  mode uploads a new listing, update mode edits an existing one by id (the
 *  我的-tab 编辑 flow). */
export default function ExpertBotPublishModal({
  visible,
  kind,
  mode = "create",
  editingId,
  onClose,
}: ExpertBotPublishModalProps) {
  useI18n();
  const spaceId = getCurrentSpaceId();
  const apiURL = WKApp.apiClient.config.apiURL;
  const isUpdate = mode === "update";
  // Depend on kind + mode + editingId + spaceId + apiURL — resolveMcpAPIBaseURL
  // derives from apiURL first and falls back to window.location.origin (treated
  // as stable), so a runtime apiURL change on the mutable client config must
  // bust the cache.
  const prompt = useMemo(
    () =>
      getExpertBotPublishPrompt({
        kind,
        mode,
        id: editingId,
        spaceId,
        apiBaseUrl: resolveMcpAPIBaseURL(apiURL, window.location.origin),
      }),
    [kind, mode, editingId, spaceId, apiURL]
  );

  const title = isUpdate
    ? kind === "squad"
      ? t("mcp.expert.botUpdateTitle")
      : t("mcp.expert.botUpdateTitleAgent")
    : kind === "squad"
    ? t("mcp.expert.botPublishTitle")
    : t("mcp.expert.botPublishTitleAgent");

  return (
    <PromptForwardModal
      visible={visible}
      onClose={onClose}
      title={title}
      hint={isUpdate ? t("mcp.expert.botUpdateHint") : t("mcp.expert.botPublishHint")}
      kind={isUpdate ? "update" : "publish"}
      icon={<Bot size={18} />}
      prompt={prompt}
      spaceId={spaceId}
      onForwarded={onClose}
    />
  );
}
