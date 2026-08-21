import { Button } from "@octo/ui";
import Select from "@octo/ui/select";
import React, { useEffect, useState } from "react";
import { WKModal, t, useI18n } from "@octo/base";
import { Toast } from "@douyinfe/semi-ui";
import type { ExpertItem } from "../mock/expertMock";
import {
  installExpertToLoop,
  installSquadToLoop,
  getLoopRuntimes,
  getLoopWorkspaces,
} from "../api/expertService";
import type { LoopRuntime, LoopWorkspace } from "../api/expertService";

// A runtime is "ready" to run an agent when it has no status (older fleet builds
// omit it) or reports one of the known healthy states. Anything else (offline /
// error / provisioning) is treated as not-ready: skipped for default selection
// and annotated in the picker. The status domain is fleet-owned, so we match
// leniently rather than enumerate it exhaustively.
function isRuntimeReady(rt: LoopRuntime): boolean {
  if (!rt.status) return true;
  return ["online", "ready", "running", "active"].includes(
    rt.status.toLowerCase()
  );
}

interface ExpertAddToLoopModalProps {
  item: ExpertItem | null;
  onClose: () => void;
}

/**
 * "添加到回路" dialog opened from an expert / squad card. Unlike the copy-a-prompt
 * install flow, this provisions directly: the user picks a Loop workspace and a
 * runtime, and the marketplace backend orchestrates the install server-side. For
 * a single expert that means one agent (installExpertToLoop); for a squad it
 * means installing each member as an agent then forming the squad
 * (installSquadToLoop). The workspace/runtime picker is identical for both.
 */
export default function ExpertAddToLoopModal({
  item,
  onClose,
}: ExpertAddToLoopModalProps) {
  useI18n();
  const [workspaces, setWorkspaces] = useState<LoopWorkspace[]>([]);
  const [runtimes, setRuntimes] = useState<LoopRuntime[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [runtimeId, setRuntimeId] = useState<string>("");
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingRuntimes, setLoadingRuntimes] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const visible = Boolean(item);

  // Load workspaces when the dialog opens; reset all selection state so a
  // second open (possibly for a different expert) starts clean.
  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setWorkspaceId("");
    setRuntimeId("");
    setRuntimes([]);
    setLoadingWorkspaces(true);
    getLoopWorkspaces()
      .then((list) => {
        if (cancelled) return;
        setWorkspaces(list);
        // Default-select the first workspace so the runtime picker populates
        // immediately; the user rarely has more than one and can still switch.
        if (list.length > 0) {
          setWorkspaceId(list[0].id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setWorkspaces([]);
        Toast.error(err instanceof Error ? err.message : t("mcp.expert.installFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingWorkspaces(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item]);

  // Load runtimes whenever the chosen workspace changes. Runtimes belong to a
  // workspace, so clear the prior runtime selection first.
  useEffect(() => {
    if (!item || !workspaceId) {
      setRuntimes([]);
      return;
    }
    let cancelled = false;
    setRuntimeId("");
    setLoadingRuntimes(true);
    getLoopRuntimes(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setRuntimes(list);
        // Default-select the first READY runtime so the dialog is confirmable in
        // one click without picking a runtime that can't actually run the agent;
        // fall back to the first runtime if none report ready. The user can
        // still switch before confirming.
        if (list.length > 0) {
          const firstReady = list.find(isRuntimeReady) ?? list[0];
          setRuntimeId(firstReady.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setRuntimes([]);
        Toast.error(err instanceof Error ? err.message : t("mcp.expert.installFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingRuntimes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, workspaceId]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (!item || !workspaceId || !runtimeId || submitting) return;
    setSubmitting(true);
    try {
      // Squads install each member then form the team; experts install one
      // agent. Both take the same workspace/runtime selection and throw if the
      // backend 2xx carries no id (so we never falsely report success).
      if (item.kind === "squad") {
        await installSquadToLoop(item.id, { workspaceId, runtimeId });
      } else {
        await installExpertToLoop(item.id, { workspaceId, runtimeId });
      }
      Toast.success(t("mcp.expert.installSuccess"));
      onClose();
    } catch (err) {
      Toast.error(
        err instanceof Error ? err.message : t("mcp.expert.installFailed")
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!item) return null;

  const workspaceOptions = workspaces.map((w) => ({ label: w.name, value: w.id }));
  const runtimeOptions = runtimes.map((rt) => ({
    // Surface a non-ready status so the user isn't silently defaulted onto (or
    // left picking) a runtime that can't run the agent. The status value itself
    // is fleet data (shown raw); the surrounding chrome is localized.
    label: isRuntimeReady(rt)
      ? rt.name
      : t("mcp.expert.runtimeWithStatus", {
          values: { name: rt.name, status: rt.status ?? "" },
        }),
    value: rt.id,
  }));
  const canSubmit = Boolean(workspaceId && runtimeId) && !submitting;

  return (
    <WKModal
      visible={visible}
      onCancel={handleClose}
      width={480}
      className="wk-mcp-add-to-loop-modal"
      title={t("mcp.expert.addToLoopTitle")}
      footer={
        <div className="wk-mcp-form-footer__right">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            {t("mcp.expert.cancel")}
          </Button>
          <Button variant="solid" onClick={handleConfirm} disabled={!canSubmit}>
            {submitting ? t("mcp.expert.installing") : t("mcp.expert.confirmInstall")}
          </Button>
        </div>
      }
    >
      <div className="wk-mcp-add-to-loop">
        <p className="wk-mcp-add-to-loop__target" title={item.name}>
          {item.name}
        </p>

        <label className="wk-mcp-add-to-loop__label">
          {t("mcp.expert.selectWorkspace")}
        </label>
        <Select
          style={{ width: "100%" }}
          value={workspaceId || undefined}
          optionList={workspaceOptions}
          loading={loadingWorkspaces}
          disabled={submitting}
          placeholder={t("mcp.expert.selectWorkspacePlaceholder")}
          emptyContent={t("mcp.expert.noWorkspaces")}
          onChange={(v) => setWorkspaceId(v as string)}
        />

        <label className="wk-mcp-add-to-loop__label">
          {t("mcp.expert.selectRuntime")}
        </label>
        <Select
          style={{ width: "100%" }}
          value={runtimeId || undefined}
          optionList={runtimeOptions}
          loading={loadingRuntimes}
          disabled={!workspaceId || submitting}
          placeholder={t("mcp.expert.selectRuntimePlaceholder")}
          emptyContent={t("mcp.expert.noRuntimes")}
          onChange={(v) => setRuntimeId(v as string)}
        />

        <p className="wk-mcp-add-to-loop__note">
          {item.kind === "squad"
            ? t("mcp.expert.secretPlaceholderNoteSquad")
            : t("mcp.expert.secretPlaceholderNote")}
        </p>
      </div>
    </WKModal>
  );
}
