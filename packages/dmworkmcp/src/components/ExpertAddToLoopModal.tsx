import React, { useEffect, useRef, useState } from "react";
import { WKModal, WKButton, t, useI18n } from "@octo/base";
import { Select, Toast } from "@douyinfe/semi-ui";
import type { ExpertItem } from "../mock/expertMock";
import {
  installExpertToLoop,
  installSquadToLoop,
  getLoopRuntimes,
  getLoopWorkspaces,
  createLoopInstallationKey,
} from "../api/expertService";
import type { LoopRuntime, LoopWorkspace } from "../api/expertService";

import LoopRuntimePicker from "../ui/LoopRuntimePicker";
import {
  buildRuntimeGroups,
  canInstallRuntime,
  isRuntimeReady,
} from "../bridge/loopRuntimePicker/model";

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
  const [runtimeScope, setRuntimeScope] = useState<"mine" | "all">("mine");
  const [allRuntimes, setAllRuntimes] = useState<LoopRuntime[]>([]);
  const [loadingAllRuntimes, setLoadingAllRuntimes] = useState(false);
  const [allRuntimeError, setAllRuntimeError] = useState(false);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingRuntimes, setLoadingRuntimes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const operationKeys = useRef(new Map<string, string>());
  const activeItem = useRef(item);
  activeItem.current = item;

  const visible = Boolean(item);

  // Load workspaces when the dialog opens; reset all selection state so a
  // second open (possibly for a different expert) starts clean.
  useEffect(() => {
    setRuntimeScope("mine");
    setAllRuntimes([]);
    setWorkspaceId("");
    setRuntimeId("");
    setRuntimes([]);
    setLoadingWorkspaces(Boolean(item));
    if (!item) return;
    let cancelled = false;
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
        Toast.error(
          err instanceof Error ? err.message : t("mcp.expert.installFailed")
        );
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
    // Readiness gates installation, so refresh even if market prefetch or a
    // previous dialog session already cached this workspace's runtimes.
    getLoopRuntimes(workspaceId, { refresh: true })
      .then((list) => {
        if (cancelled) return;
        setRuntimes(list);
        // The service requests owner=me. Never fall back to an unavailable
        // runtime when none of the current user's machines are ready.
        setRuntimeId(list.find(isRuntimeReady)?.id ?? "");
      })
      .catch((err) => {
        if (cancelled) return;
        setRuntimes([]);
        Toast.error(
          err instanceof Error ? err.message : t("mcp.expert.installFailed")
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingRuntimes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, workspaceId]);

  // Fetch All only on demand. Scope is part of the cache key; its response must
  // never supply the owned-list default or overwrite a newer workspace/tab.
  useEffect(() => {
    if (!item || !workspaceId || runtimeScope !== "all") return;
    let cancelled = false;
    setLoadingAllRuntimes(true);
    setAllRuntimeError(false);
    setAllRuntimes([]);
    getLoopRuntimes(workspaceId, { refresh: true, scope: "all" })
      .then((list) => {
        if (cancelled) return;
        setAllRuntimes(list);
        // Keep an explicit selection if still present, never pick the first
        // All result (which can be another member's machine).
        setRuntimeId((previous) =>
          list.some((r) => r.id === previous) ? previous : ""
        );
      })
      .catch(() => {
        if (cancelled) return;
        setAllRuntimeError(true);
        setAllRuntimes([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAllRuntimes(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, workspaceId, runtimeScope]);

  const ownedIds = new Set(
    runtimes.filter((rt) => rt.canBind !== false).map((rt) => rt.id)
  );
  const visibleRuntimes = runtimeScope === "mine" ? runtimes : allRuntimes;
  const loadingTargets =
    loadingRuntimes || (runtimeScope === "all" && loadingAllRuntimes);
  const validSelection = visibleRuntimes.some(
    (rt) =>
      rt.id === runtimeId &&
      (runtimeScope === "mine"
        ? ownedIds.has(rt.id) && isRuntimeReady(rt)
        : canInstallRuntime(rt, ownedIds))
  );

  const changeRuntimeScope = (scope: "mine" | "all") => {
    if (scope === runtimeScope) return;
    setRuntimeScope(scope);
    if (scope === "all") {
      setAllRuntimes([]);
      setAllRuntimeError(false);
      setLoadingAllRuntimes(true);
    } else if (!ownedIds.has(runtimeId)) {
      setRuntimeId("");
    }
  };

  const handleClose = () => {
    if (inFlight.current) return;
    onClose();
  };

  const handleConfirm = async () => {
    if (
      !item ||
      !workspaceId ||
      loadingWorkspaces ||
      loadingTargets ||
      !validSelection ||
      inFlight.current
    )
      return;
    inFlight.current = true;
    setSubmitting(true);
    try {
      const operation = JSON.stringify([
        item.kind,
        item.id,
        workspaceId,
        runtimeId,
      ]);
      let idempotencyKey = operationKeys.current.get(operation);
      if (!idempotencyKey) {
        idempotencyKey = createLoopInstallationKey();
        operationKeys.current.set(operation, idempotencyKey);
      }
      const options = { workspaceId, runtimeId, idempotencyKey };
      // Failed/uncertain outcomes retain the original key. Do not retry through
      // another route or create a fresh key on each click.
      if (item.kind === "squad") {
        await installSquadToLoop(item.id, options);
      } else {
        await installExpertToLoop(item.id, options);
      }
      operationKeys.current.delete(operation);
      if (activeItem.current !== item) return;
      Toast.success(t("mcp.expert.installSuccess"));
      onClose();
    } catch (err) {
      if (activeItem.current !== item) return;
      Toast.error(
        err instanceof Error ? err.message : t("mcp.expert.installFailed")
      );
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  if (!item) return null;

  const workspaceOptions = workspaces.map((w) => ({
    label: w.name,
    value: w.id,
  }));
  const canSubmit =
    Boolean(workspaceId) &&
    validSelection &&
    !loadingWorkspaces &&
    !loadingTargets &&
    !submitting;

  return (
    <WKModal
      visible={visible}
      onCancel={handleClose}
      width={480}
      className="wk-mcp-add-to-loop-modal"
      title={t("mcp.expert.addToLoopTitle")}
      footer={
        <div className="wk-mcp-form-footer__right">
          <WKButton
            variant="secondary"
            onClick={handleClose}
            disabled={submitting}
          >
            {t("mcp.expert.cancel")}
          </WKButton>
          <WKButton
            variant="primary"
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {submitting
              ? t("mcp.expert.installing")
              : t("mcp.expert.confirmInstall")}
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
          onChange={(v) => {
            setRuntimeScope("mine");
            setAllRuntimes([]);
            setRuntimeId("");
            setRuntimes([]);
            setLoadingRuntimes(true);
            setWorkspaceId(v as string);
          }}
        />

        <label className="wk-mcp-add-to-loop__label">
          {t("mcp.expert.selectRuntime")}
        </label>
        <LoopRuntimePicker
          key={workspaceId}
          value={runtimeId}
          groups={buildRuntimeGroups(visibleRuntimes, {
            ownedIds,
            scope: runtimeScope,
          })}
          scope={runtimeScope}
          onScopeChange={changeRuntimeScope}
          loading={loadingTargets}
          error={
            runtimeScope === "all" && allRuntimeError
              ? t("mcp.runtimePicker.loadFailed")
              : undefined
          }
          disabled={!workspaceId || submitting}
          onChange={setRuntimeId}
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
