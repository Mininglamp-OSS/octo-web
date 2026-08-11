import React, { useEffect, useState } from "react";
import { WKModal, WKButton, t, useI18n } from "@octo/base";
import { Select, Toast } from "@douyinfe/semi-ui";
import type { ExpertItem } from "../mock/expertMock";
import {
  installExpertToLoop,
  listLoopRuntimes,
  listLoopWorkspaces,
} from "../api/expertService";
import type { LoopRuntime, LoopWorkspace } from "../api/expertService";

interface ExpertAddToLoopModalProps {
  item: ExpertItem | null;
  onClose: () => void;
  /** Called after a successful install (before the modal closes). */
  onInstalled?: (agentId: string) => void;
}

/**
 * "添加到回路" dialog opened from an expert card. Unlike the copy-a-prompt
 * install flow, this creates the agent (+ its skills) directly: the user picks
 * a Loop workspace and a runtime, and the marketplace backend orchestrates the
 * install server-side (see installExpertToLoop). Experts only — squads are not
 * supported in this flow.
 */
export default function ExpertAddToLoopModal({
  item,
  onClose,
  onInstalled,
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
    listLoopWorkspaces()
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
    listLoopRuntimes(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setRuntimes(list);
        // Default-select the first runtime so the dialog is confirmable in one
        // click; the user can still switch before confirming.
        if (list.length > 0) {
          setRuntimeId(list[0].id);
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
      const { agentId } = await installExpertToLoop(item.id, {
        workspaceId,
        runtimeId,
      });
      Toast.success(t("mcp.expert.installSuccess"));
      onInstalled?.(agentId);
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
  const runtimeOptions = runtimes.map((rt) => ({ label: rt.name, value: rt.id }));
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
          <WKButton variant="secondary" onClick={handleClose} disabled={submitting}>
            {t("mcp.expert.cancel")}
          </WKButton>
          <WKButton variant="primary" onClick={handleConfirm} disabled={!canSubmit}>
            {submitting ? t("mcp.expert.installing") : t("mcp.expert.confirmInstall")}
          </WKButton>
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
          {t("mcp.expert.secretPlaceholderNote")}
        </p>
      </div>
    </WKModal>
  );
}
