import { mapDependencyIssues } from "../../api/expertWire";
import { publicationErrorMessage } from "@dmwork/skillmarket/src/utils/publicationError";
import { PublicationEditorFields } from "../../ui/PublicationEditor";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  t,
  useI18n,
  WKApp,
  WKButton,
  WKModal,
} from "@octo/base";
import {
  nextPatch,
  upgradeVersionErrorKey,
  versionErrorKey,
} from "@dmwork/skillmarket";
import {
  PublicationService,
  type PublicationDependency,
  type DependencyUpdate,
} from "@dmwork/skillmarket/src/Service/PublicationService";
import {
  editPublicationDraft,
  type PublicationFields,
} from "@dmwork/skillmarket/src/features/publications/publicationDraft";
import { resolveSkillMarketApiBaseURL } from "@dmwork/skillmarket/src/api/constants";
import type { PluginDetailWire } from "@dmwork/skillmarket/src/api/pluginWire";
import type { ExpertItem } from "../../mock/expertMock";
import { DependencyUpdateFlow, type DependencyRecovery } from "./DependencyUpdateFlow";

export interface PublicationEditorProps {
  item: ExpertItem | null;
  onClose: () => void;
  onSaved: (message: string) => void;
  onEditContent: (item: ExpertItem) => void;
  /** Unsaved update inputs carried from a list conflict; consumed once after load. */
  recovery?: DependencyRecovery;
}
const empty: PublicationFields = {
  name: "",
  description: "",
  instruction: "",
  version: "",
  changelog: "",
  versions: {},
};

export function PublicationEditor({
  item,
  onClose,
  onSaved,
  onEditContent,
  recovery,
}: PublicationEditorProps) {
  const [initialVisibility, setInitialVisibility] = useState<
    "private" | "space"
  >("private");
  useI18n();
  const [draft, setDraft] = useState<PluginDetailWire | null>(null);
  const [fields, setFields] = useState<PublicationFields>(empty);
  const [deps, setDeps] = useState<PublicationDependency[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const updateDraft = useMemo(
    () => updatesOpen && draft ? editPublicationDraft(draft, fields) : null,
    [updatesOpen, draft, fields]
  );
  const [reconciliation, setReconciliation] = useState<{
    latest: PluginDetailWire;
    dependencies: PublicationDependency[];
    local: PublicationFields;
    remote: PublicationFields;
  } | null>(null);
  const generation = useRef(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const pendingRecovery = useRef<DependencyRecovery | undefined>(undefined);
  useEffect(() => {
    pendingRecovery.current = recovery;
  }, [recovery]);
  const [alerts, setAlerts] = useState<DependencyUpdate[]>([]);
  const refreshAlerts = () => {
    if (!item) return;
    const token = generation.current;
    void PublicationService.getUpdates(resolveSkillMarketApiBaseURL(), item.id)
      .then((result) => {
        if (token === generation.current)
          setAlerts(result.updates.filter((u) => !u.is_skipped));
      })
      .catch(() => {
        /* Editor remains usable; explicit View updates surfaces errors. */
      });
  };
  useEffect(() => {
    const close = () => {
      generation.current++;
      setDraft(null);
      closeRef.current();
    };
    WKApp.mittBus.on("space-changed", close);
    return () => {
      generation.current++;
      WKApp.mittBus.off("space-changed", close);
    };
  }, []);
  useEffect(() => {
    const token = ++generation.current;
    setDraft(null);
    setFields(empty);
    setDeps([]);
    setBusy(false);
    setError("");
    setUpdatesOpen(false);
    setReconciliation(null);
    if (!item) return;
    const base = resolveSkillMarketApiBaseURL();
    void PublicationService.getDraft(base, item.id)
      .then(async (value) => {
        const [dependencies, instruction] = await Promise.all([
          PublicationService.getDependencies(base, value),
          PublicationService.getInstruction(base, value),
        ]);
        if (token !== generation.current) return;
        const released = value.plugin.published_version;
        const current = value.plugin.current_version ?? item.version ?? "1.0.0";
        setDraft(value);
        setInitialVisibility(
          value.plugin.visibility === "space" ? "space" : "private"
        );
        setDeps(dependencies);
        setAlerts([]);
        refreshAlerts();
        const loaded: PublicationFields = {
          name: value.plugin.plugin_name,
          description: value.plugin.manifest_json.description ?? "",
          instruction,
          version: released === current ? nextPatch(released) : current,
          changelog: value.draft_changelog ?? "",
          versions: Object.fromEntries(
            value.relations
              .filter((r) => r.target_version_id)
              .map((r) => [r.target_plugin_id, r.target_version_id!])
          ),
        };
        setFields(loaded);
        // A list-originated recovery rides in with the edit request. Apply it
        // once, against the draft just loaded, so the author compares real
        // values instead of the empty form defaults.
        const wanted = pendingRecovery.current;
        if (
          wanted &&
          (wanted.version !== null ||
            wanted.changelog !== null ||
            Object.keys(wanted.versions).length > 0)
        ) {
          setReconciliation({
            latest: value, dependencies, remote: loaded,
            local: {
              ...loaded,
              version: wanted.version ?? loaded.version,
              changelog: wanted.changelog ?? loaded.changelog,
              versions: { ...loaded.versions, ...wanted.versions },
            },
          });
        }
        pendingRecovery.current = undefined;
      })
      .catch((err) => {
        if (token === generation.current)
          setError(
            publicationErrorMessage(err, "skillMarket.common.loadFailed")
          );
      });
    return () => {
      generation.current++;
    };
  }, [item, attempt]);
  const reconcile = async (
    recovery: DependencyRecovery,
    baseFields?: PublicationFields
  ) => {
    if (!item) return;
    const token = generation.current;
    const base = resolveSkillMarketApiBaseURL();
    const latest = await PublicationService.getDraft(base, item.id);
    const [dependencies, instruction] = await Promise.all([
      PublicationService.getDependencies(base, latest),
      PublicationService.getInstruction(base, latest),
    ]);
    if (token !== generation.current) return;
    const local = baseFields ?? fields;
    setReconciliation({
      latest, dependencies,
      // null means the update form never owned that field: keep the editor value.
      local: { ...local,
        version: recovery.version ?? local.version,
        changelog: recovery.changelog ?? local.changelog,
        versions: { ...local.versions, ...recovery.versions } },
      remote: {
        name: latest.plugin.plugin_name,
        description: latest.plugin.manifest_json.description ?? "",
        instruction,
        version: latest.plugin.current_version === latest.plugin.published_version
          ? nextPatch(latest.plugin.published_version) : latest.plugin.current_version ?? "1.0.0",
        changelog: latest.draft_changelog ?? "",
        versions: Object.fromEntries(latest.relations.filter(r => r.target_version_id).map(r => [r.target_plugin_id, r.target_version_id!])),
      },
    });
  };
  const acceptReconciliation = (chosen: PublicationFields) => {
    if (!reconciliation) return;
    setDraft(reconciliation.latest);
    setDeps(reconciliation.dependencies);
    setInitialVisibility(reconciliation.latest.plugin.visibility === "space" ? "space" : "private");
    setFields(chosen);
    setError("");
    setReconciliation(null);
  };
  const set = <K extends keyof PublicationFields>(
    key: K,
    value: PublicationFields[K]
  ) => setFields((old) => ({ ...old, [key]: value }));
  const versionError = versionErrorKey(
    draft?.plugin.current_version,
    fields.version,
    draft?.plugin.current_version
  );
  const publishError = upgradeVersionErrorKey(
    draft?.plugin.published_version,
    fields.version
  );
  const blocked =
    item?.displayStatus === "pending_review" ||
    draft?.plugin.display_status === "pending_review" ||
    (!!draft &&
      draft.plugin.visibility !== "private" &&
      draft.plugin.visibility !== "space");
  const canSave = !reconciliation &&
    !!draft &&
    !busy &&
    !blocked &&
    !!fields.name.trim() &&
    !!fields.version.trim() &&
    !versionError;
  async function submit(publish: boolean, handoff = false) {
    if (
      !draft ||
      !item ||
      !canSave ||
      (publish && (publishError || !fields.changelog.trim()))
    )
      return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const payload = editPublicationDraft(draft, fields);
      if (
        !draft.plugin.published_version_id &&
        draft.plugin.listing_state === "draft"
      )
        payload.plugin.visibility = initialVisibility;
      const saved = await PublicationService.saveDraft(
        resolveSkillMarketApiBaseURL(),
        payload
      );
      if (token !== generation.current) return;
      setDraft({
        ...saved,
        plugin: {
          ...saved.plugin,
          published_version: draft.plugin.published_version,
          published_version_id: draft.plugin.published_version_id,
        },
      });
      if (handoff) {
        onSaved(t("skillMarket.plugin.draftSavedToast"));
        onEditContent({ ...item, draftRevision: saved.draft_revision });
        return;
      }
      if (publish) {
        if (!saved.draft_revision)
          throw new Error(t("skillMarket.errors.stateConflict"));
        const result = await PublicationService.publishDraft(
          resolveSkillMarketApiBaseURL(),
          item.id,
          fields.version,
          fields.changelog,
          saved.draft_revision
        );
        if (token !== generation.current) return;
        onSaved(
          t(
            result.display_status === "pending_review"
              ? "skillMarket.review.submittedToast"
              : "skillMarket.plugin.publishedToast"
          )
        );
      } else onSaved(t("skillMarket.plugin.draftSavedToast"));
      onClose();
    } catch (err) {
      if (token === generation.current)
        setError(
          publicationErrorMessage(err, "skillMarket.form.saveFailed")
        );
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <>
      <WKModal
        size="lg"
        width="min(720px, calc(100vw - var(--wk-sp-8)))"
        className="publication-editor-modal"
        visible={!!item}
        onCancel={() => {
          if (!busy) onClose();
        }}
        title={<div className="publication-editor-heading">
          <span>{t("skillMarket.form.editTitle", { values: { name: t(item?.kind === "squad" ? "mcp.expert.typeSquad" : "mcp.expert.typeAgent") } })}</span>
          {draft?.plugin.published_version && <span className="wk-mine-table__version">{t("skillMarket.publication.currentVersionLabel", { values: { version: draft.plugin.published_version } })}</span>}
        </div>}
        footer={
          <>
            <WKButton variant="secondary" onClick={onClose} disabled={busy}>
              {t("skillMarket.common.cancel")}
            </WKButton>
            <WKButton
              variant="secondary"
              onClick={() => void submit(false)}
              disabled={!canSave}
              loading={busy}
            >
              {t("skillMarket.plugin.actionSaveDraft")}
            </WKButton>
            <WKButton
              variant="primary"
              onClick={() => void submit(true)}
              disabled={!canSave || !!publishError || !fields.changelog.trim()}
            >
              {t("skillMarket.publication.publishNewVersion")}
            </WKButton>
          </>
        }
      >
        <PublicationEditorFields
          item={item}
          dependencyIssues={mapDependencyIssues(draft?.dependency_issues ?? draft?.plugin.dependency_issues) ?? item?.dependencyIssues}
          dependencySuspended={item?.dependencySuspended}
          draft={draft}
          fields={fields}
          deps={deps}
          alerts={alerts}
          busy={busy}
          blocked={blocked}
          error={error}
          canSave={canSave}
          versionError={versionError}
          publishError={publishError}
          initialVisibility={initialVisibility}
          onFieldChange={set}
          onRetry={() => setAttempt((a) => a + 1)}
          onBotUpdate={() => void submit(false, true)}
          onShowUpdates={() => setUpdatesOpen(true)}
          onInitialVisibilityChange={setInitialVisibility}
        />
      </WKModal>
      {reconciliation && <WKModal
        visible
        title={t("skillMarket.publication.reconcileTitle")}
        onCancel={onClose}
        footer={<>
          <WKButton variant="secondary" onClick={onClose}>{t("skillMarket.common.cancel")}</WKButton>
          <WKButton onClick={() => acceptReconciliation(reconciliation.remote)}>{t("skillMarket.publication.useLatest")}</WKButton>
          <WKButton onClick={() => acceptReconciliation(reconciliation.local)}>{t("skillMarket.publication.keepLocal")}</WKButton>
        </>}
      >
        <p>{t("skillMarket.publication.reconcileHint")}</p>
        {(["remote", "local"] as const).map(side => {
          const values = reconciliation[side];
          return <section key={side}>
            <h3>{t(side === "remote" ? "skillMarket.publication.latestDraft" : "skillMarket.publication.localEdits")}</h3>
            <dl>
              {(["name", "description", "instruction", "version", "changelog"] as const).map(key =>
                <React.Fragment key={key}><dt>{t("skillMarket.publication.compare." + key)}</dt><dd>{values[key]}</dd></React.Fragment>
              )}
              {reconciliation.dependencies.filter(dep => dep.type !== "connector").map(dep =>
                <React.Fragment key={dep.id}><dt>{dep.name}</dt><dd>{dep.versions.find(v => v.id === values.versions[dep.id])?.label ?? t("skillMarket.publication.boundVersion")}</dd></React.Fragment>
              )}
            </dl>
          </section>;
        })}
      </WKModal>}
      {item && updateDraft && (
        <DependencyUpdateFlow
          pluginId={item.id}
          listingState={draft?.plugin.listing_state}
          onEdit={reconcile}
          pending={blocked}
          draft={updateDraft}
          onClose={() => setUpdatesOpen(false)}
          onSkipped={refreshAlerts}
          onSaved={(message) => {
            onSaved(message);
            onClose();
          }}
        />
      )}
    </>
  );
}
