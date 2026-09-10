import React, { useEffect, useState } from "react";
import { WKButton, useI18n } from "@octo/base";
import type {
  SummaryFormalContent, SummaryFormalVersion, SummaryGenerationConfiguration,
  SummaryGenerationSpec, SummaryGenerationSchedule, SummarySaveConfigurationRequest,
} from "../../Service/SummaryContentContract";
import "./FormalContentPanel.css";

export interface FormalContentPanelState {
  configuration: SummaryGenerationConfiguration | null;
  versions: SummaryFormalVersion[];
  hasMore: boolean;
  pending: boolean;
  errorKey: string;
  noticeKey: string;
  sourceLabels: string[];
  draftSpec: SummaryGenerationSpec | null;
}

export interface FormalContentPanelActions {
  onChooseSources: () => void;
  onDraftSpecChange: (spec: SummaryGenerationSpec) => void;
  onConfigure: () => void;
  onSaveConfiguration: (request: SummarySaveConfigurationRequest, generate: boolean) => Promise<boolean>;
  onRefine: (feedback: string) => Promise<boolean>;
  onRegenerate: () => void;
  onEdit: (content: string) => Promise<boolean>;
  onRestore: (version: string) => Promise<boolean>;
  onVersions: (more?: boolean) => void;
  onCancel: () => void;
  onApply: (generation: string) => void;
  onReload: () => void;
}

export interface FormalContentPanelProps {
  title: string;
  content: SummaryFormalContent;
  state: FormalContentPanelState;
  actions: FormalContentPanelActions;
  renderVersion: (version: SummaryFormalVersion) => React.ReactNode;
  /** Reuse only the form inside Octo's existing detail configuration dialog. */
  configurationOnly?: boolean;
}

const defaultSchedule: SummaryGenerationSchedule = {
  enabled: false, interval_days: 7, interval_months: 0, run_time: "09:00", day_of_week: 0, day_of_month: 0,
};

export function shanghaiDateInput(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function FormalContentPanel(panelProps: FormalContentPanelProps) {
  const props = { ...panelProps, ...panelProps.state, ...panelProps.actions };
  const { t, format } = useI18n();
  const { content, configuration, draftSpec, pending } = props;
  const [panel, setPanel] = useState<"refine" | "configuration" | "versions" | "edit" | null>(props.configurationOnly ? "configuration" : null);
  const [feedback, setFeedback] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [schedule, setSchedule] = useState(defaultSchedule);
  const [preview, setPreview] = useState<SummaryFormalVersion | null>(null);
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const current = content.current_version;
  const busy = Boolean(content.active_generation);
  const run = content.active_generation ?? content.latest_generation;
  const caps = content.capabilities;
  useEffect(() => {
    setSchedule(configuration?.schedule ?? defaultSchedule);
    setConfirmed(false);
  }, [configuration]);
  useEffect(() => { setRestoreConfirmed(false); }, [preview?.version_id]);
  useEffect(() => { setPreview(null); }, [current?.version_id, content.content_revision]);
  useEffect(() => { setConfirmed(false); }, [draftSpec]);
  const changeSpec = (spec: SummaryGenerationSpec) => { props.onDraftSpecChange(spec); setConfirmed(false); };
  const setTime = (patch: SummaryGenerationSpec["time_selector"]) => {
    if (draftSpec) changeSpec({ ...draftSpec, time_selector: patch });
  };
  const save = async (generate: boolean) => {
    if (!configuration || !draftSpec || !confirmed) return;
    await props.onSaveConfiguration({
      expected_config_revision: configuration.revision,
      spec: { ...draftSpec, requirement: draftSpec.requirement ?? "", sources: draftSpec.sources.map((source) => ({ ...source, confirmation: "user_confirmed" })) },
      schedule,
    }, generate);
  };
  const dateValue = shanghaiDateInput;
  return <section className={`wk-summary-formal${props.configurationOnly ? " wk-summary-formal--configuration" : ""}`} aria-label={t("summary.formal.target")}>
    {!props.configurationOnly && <header className="wk-summary-formal__header">
      <h2>{props.title}</h2>
      {current && <p>{t("summary.formal.versionRevision", { values: { version: current.version, revision: content.content_revision } })}</p>}
      <div className="wk-summary-formal__actions">
        <WKButton disabled={pending || !caps.can_refine} onClick={() => setPanel(panel === "refine" ? null : "refine")}>{t("summary.formal.refine")}</WKButton>
        <WKButton disabled={pending || !caps.can_edit} onClick={() => { setDraftBody(current?.content ?? ""); setConfirmed(false); setPanel("edit"); }}>{t("summary.formal.edit")}</WKButton>
        {caps.can_configure_schedule && <WKButton disabled={pending} onClick={() => { setPanel("configuration"); props.onConfigure(); }}>{t("summary.formal.configure")}</WKButton>}
        <WKButton disabled={pending || !caps.can_view_versions} onClick={() => { setPanel("versions"); props.onVersions(); }}>{t("summary.formal.versions")}</WKButton>
      </div>
    </header>}
    {props.errorKey && <div role="alert" className="wk-summary-formal__error">{t(props.errorKey)} <WKButton disabled={pending} onClick={props.onReload}>{t("summary.common.retry")}</WKButton></div>}
    {props.noticeKey && <p role="status">{t(props.noticeKey)}</p>}
    {!props.configurationOnly && run && <div role="status" className="wk-summary-formal__run">
      <span>{t(`summary.formal.run.${run.status}`)}</span>
      {busy && <WKButton disabled={pending} onClick={props.onCancel}>{t("summary.formal.cancelRun")}</WKButton>}
      {run.status === "conflict" && <WKButton disabled={pending} onClick={() => { setPanel("versions"); props.onVersions(); }}>{t("summary.formal.previewCandidate")}</WKButton>}
    </div>}
    <div className="wk-summary-formal__layout">
      {!props.configurationOnly && <article className="wk-summary-formal__body">{current ? props.renderVersion(current) : t("summary.formal.empty")}</article>}
      {panel && <aside className="wk-summary-formal__panel" aria-label={t(`summary.formal.${panel}`)}>
        {!props.configurationOnly && <div className="wk-summary-formal__actions"><h3>{t(`summary.formal.${panel}`)}</h3><WKButton onClick={() => setPanel(null)}>{t("summary.common.close")}</WKButton></div>}
        {panel === "refine" && <>
          <p>{t("summary.formal.refineHint")}</p>
          <label>{t("summary.formal.feedback")}<textarea value={feedback} maxLength={2000} disabled={pending || busy} onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (feedback.trim() && caps.can_refine && !pending) void props.onRefine(feedback); } }} /></label>
          <WKButton disabled={pending || !caps.can_refine || !feedback.trim()} onClick={() => void props.onRefine(feedback)}>{t("summary.formal.refine")}</WKButton>
          {caps.can_regenerate_direct && <WKButton disabled={pending} onClick={props.onRegenerate}>{t("summary.formal.regenerate")}</WKButton>}
          {caps.can_regenerate_with_config && <WKButton disabled={pending} onClick={() => { setPanel("configuration"); props.onConfigure(); }}>{t(content.generation_config.state === "complete" ? "summary.formal.modifyConfiguration" : "summary.formal.completeConfiguration")}</WKButton>}
        </>}
        {panel === "edit" && <>
          <p>{t("summary.formal.overwriteWarning")}</p>
          <label>{t("summary.formal.body")}<textarea value={draftBody} disabled={pending || busy} onChange={(e) => setDraftBody(e.target.value)} /></label>
          <label className="wk-summary-formal__check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("summary.formal.confirmOverwrite")}</label>
          <WKButton disabled={pending || !caps.can_edit || !confirmed || !draftBody.trim()} onClick={async () => { if (await props.onEdit(draftBody)) setPanel(null); }}>{t("summary.common.save")}</WKButton>
        </>}
        {panel === "configuration" && (!configuration || !draftSpec ? <p role="status">{t("summary.formal.loading")}</p> : <>
          <p>{t("summary.formal.configurationHint")}</p>
          <label>{t("summary.formal.sources")}<span>{props.sourceLabels.join(", ") || t("summary.formal.chooseSources")}</span><WKButton disabled={pending} onClick={props.onChooseSources}>{t("summary.formal.chooseSources")}</WKButton></label>
          <label>{t("summary.formal.timeMode")}<select value={draftSpec.time_selector.mode} disabled={pending} onChange={(e) => {
            const mode = e.target.value;
            if (mode === "relative") setTime({ mode, timezone: "Asia/Shanghai", days: 7 });
            if (mode === "natural_period") setTime({ mode, timezone: "Asia/Shanghai", unit: "week", offset: -1 });
            if (mode === "absolute") setTime({ mode, timezone: "Asia/Shanghai", start: "", end: "" });
            if (mode === "incremental") setTime({ mode, timezone: "Asia/Shanghai", initial_start: "" });
          }}>
            {["relative", "natural_period", "absolute", "incremental"].map((mode) => <option value={mode} key={mode}>{t(`summary.formal.time.${mode}`)}</option>)}
          </select></label>
          {draftSpec.time_selector.mode === "relative" && <label>{t("summary.formal.days")}<input type="number" min={1} max={90} value={draftSpec.time_selector.days ?? 7} onChange={(e) => setTime({ ...draftSpec.time_selector, days: Number(e.target.value) })} /></label>}
          {draftSpec.time_selector.mode === "natural_period" && <>
            <label>{t("summary.formal.period")}<select value={draftSpec.time_selector.unit} onChange={(e) => setTime({ ...draftSpec.time_selector, unit: e.target.value })}>{["day", "week", "month", "year"].map((unit) => <option key={unit} value={unit}>{t(`summary.formal.unit.${unit}`)}</option>)}</select></label>
            <label>{t("summary.formal.periodOffset")}<input type="number" min={1} value={-(draftSpec.time_selector.offset ?? -1)} onChange={(e) => setTime({ ...draftSpec.time_selector, offset: -Number(e.target.value) })} /></label>
          </>}
          {(draftSpec.time_selector.mode === "absolute" || draftSpec.time_selector.mode === "incremental") && <>
            <label>{t("summary.formal.start")}<input type="datetime-local" value={dateValue(draftSpec.time_selector.start ?? draftSpec.time_selector.initial_start)} onChange={(e) => setTime({ ...draftSpec.time_selector, [draftSpec.time_selector.mode === "incremental" ? "initial_start" : "start"]: e.target.value ? `${e.target.value}:00+08:00` : "" })} /></label>
            {draftSpec.time_selector.mode === "absolute" && <label>{t("summary.formal.end")}<input type="datetime-local" value={dateValue(draftSpec.time_selector.end)} onChange={(e) => setTime({ ...draftSpec.time_selector, end: e.target.value ? `${e.target.value}:00+08:00` : "" })} /></label>}
          </>}
          <p>{t("summary.formal.timezone")}</p>
          <label>{t("summary.formal.requirement")}<textarea value={draftSpec.requirement ?? ""} maxLength={2300} onChange={(e) => changeSpec({ ...draftSpec, requirement: e.target.value })} /></label>
          <label>{t("summary.formal.template")}<textarea value={draftSpec.template?.content ?? ""} onChange={(e) => changeSpec({ ...draftSpec, template: e.target.value ? { id: draftSpec.template?.id ?? "custom", version: draftSpec.template?.version ?? "1", content: e.target.value } : null })} /></label>
          <label>{t("summary.formal.keywords")}<input value={draftSpec.retrieval.keywords.join(", ")} onChange={(e) => changeSpec({ ...draftSpec, retrieval: { ...draftSpec.retrieval, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} /></label>
          <label className="wk-summary-formal__check"><input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} />{t("summary.formal.scheduleEnabled")}</label>
          {schedule.enabled && schedule.cron_expr && <p>{t("summary.formal.legacyCron", { values: { rule: schedule.cron_expr } })}</p>}
          {schedule.enabled && !schedule.cron_expr && <>
            <label>{t("summary.formal.frequency")}<select value={schedule.interval_months ? "month" : "day"} onChange={(e) => setSchedule({ ...schedule, interval_months: e.target.value === "month" ? 1 : 0, interval_days: e.target.value === "day" ? 7 : 0, day_of_week: 0, day_of_month: e.target.value === "month" ? schedule.day_of_month || 1 : 0 })}><option value="day">{t("summary.formal.unit.day")}</option><option value="month">{t("summary.formal.unit.month")}</option></select></label>
            <label>{t("summary.formal.every")}<input type="number" min={1} value={schedule.interval_months || schedule.interval_days} onChange={(e) => setSchedule({ ...schedule, [schedule.interval_months ? "interval_months" : "interval_days"]: Number(e.target.value) })} /></label>
            <label>{t("summary.formal.runTime")}<input type="time" value={schedule.run_time} onChange={(e) => setSchedule({ ...schedule, run_time: e.target.value })} /></label>
            {Boolean(schedule.interval_months) && <label>{t("summary.formal.dayOfMonth")}<input type="number" min={1} max={31} value={schedule.day_of_month || 1} onChange={(e) => setSchedule({ ...schedule, day_of_month: Number(e.target.value) })} /></label>}
          </>}
          {configuration.next_run_at && configuration.schedule?.enabled && <p>{t("summary.formal.nextRun", { values: { time: format.dateTime(configuration.next_run_at) } })}</p>}
          <label className="wk-summary-formal__check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />{t("summary.formal.confirmScope")}</label>
          <div className="wk-summary-formal__actions">
            <WKButton disabled={pending || !confirmed || draftSpec.sources.length === 0} onClick={() => void save(false)}>{t("summary.formal.saveConfiguration")}</WKButton>
            <WKButton disabled={pending || busy || !confirmed || draftSpec.sources.length === 0} onClick={() => void save(true)}>{t("summary.formal.saveAndGenerate")}</WKButton>
          </div>
        </>)}
        {panel === "versions" && <>
          {props.versions.length === 0 && <p>{t(pending ? "summary.formal.loading" : "summary.formal.empty")}</p>}
          {props.versions.map((version) => <WKButton key={version.version_id} disabled={pending} onClick={() => setPreview(version)}>
            {t("summary.formal.versionRevision", { values: { version: version.version, revision: version.content_revision } })}
            {version.pending_application ? ` · ${t("summary.formal.candidate")}` : ""}
          </WKButton>)}
          {props.hasMore && <WKButton disabled={pending} onClick={() => props.onVersions(true)}>{t("summary.formal.more")}</WKButton>}
          {preview && <section aria-label={t("summary.formal.preview")}>
            {props.renderVersion(preview)}
            {preview.pending_application && preview.generation_id ? <WKButton disabled={pending || busy || !caps.can_edit} onClick={() => props.onApply(preview.generation_id!)}>{t("summary.formal.applyCandidate")}</WKButton> :
              !preview.is_current && <>
                <p>{t("summary.formal.overwriteWarning")}</p>
                <label className="wk-summary-formal__check"><input type="checkbox" checked={restoreConfirmed} onChange={(e) => setRestoreConfirmed(e.target.checked)} />{t("summary.formal.confirmOverwrite")}</label>
                <WKButton disabled={pending || !caps.can_edit || !restoreConfirmed} onClick={async () => { if (await props.onRestore(preview.version_id)) setPreview(null); }}>{t("summary.formal.restore")}</WKButton>
              </>}
          </section>}
        </>}
      </aside>}
    </div>
  </section>;
}

export default FormalContentPanel;
