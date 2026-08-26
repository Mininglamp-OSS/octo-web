import React, { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import NavFlyout from "./NavFlyout";
import { defaultQuickMuteTime, formatLocalDateTime, quickMuteStore, type QuickMuteDuration, type QuickMuteService, type QuickMuteState } from "./QuickMuteStore";

function BellIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={muted ? "M4 4l16 16M10.3 5.2A6 6 0 0 1 18 10c0 4.5 1.4 6 2.7 7.3A1 1 0 0 1 20 19H4a1 1 0 0 1-.7-1.7C4.6 16 6 14.5 6 10a6 6 0 0 1 .6-2.6M10 21h4" : "M18 10a6 6 0 0 0-12 0c0 4.5-1.4 6-2.7 7.3A1 1 0 0 0 4 19h16a1 1 0 0 0 .7-1.7C19.4 16 18 14.5 18 10ZM10 21h4"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function QuickMuteSidebar({ service = quickMuteStore }: { service?: QuickMuteService }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<QuickMuteState>({ active: false, scope: "sound-and-popup" });
  const [loaded, setLoaded] = useState(false);
  const [customTime, setCustomTime] = useState(defaultQuickMuteTime);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"load" | "save" | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [lastAction, setLastAction] = useState<QuickMuteDuration | "resume">("30m");
  const closePopover = () => {
    setOpen(false);
    setCustomOpen(false);
    setCustomTime(defaultQuickMuteTime());
  };

  const loadState = useCallback(async () => {
    try {
      setState(await service.getState());
      setLoaded(true);
      setError(null);
    } catch {
      setError("load");
    }
  }, [service]);

  useEffect(() => {
    let mounted = true;
    void service.getState().then((next) => { if (mounted) { setState(next); setLoaded(true); setError(null); } }).catch(() => { if (mounted) setError("load"); });
    const unsubscribe = service.subscribe?.((next) => { if (mounted) { setState(next); setLoaded(true); } });
    return () => { mounted = false; unsubscribe?.(); };
  }, [service]);

  const apply = async (duration: QuickMuteDuration) => {
    setLastAction(duration);
    const endAt = duration === "custom" ? new Date(customTime).getTime() : undefined;
    if (duration === "custom" && (!Number.isFinite(endAt) || endAt <= Date.now())) { setError("save"); return; }
    setBusy(true); setError(null);
    try { setState(await service.setMute(duration === "custom" ? { duration, endAt } : { duration })); closePopover(); } catch { setError("save"); } finally { setBusy(false); }
  };
  const resume = async () => { setLastAction("resume"); setBusy(true); setError(null); try { setState(await service.resume()); closePopover(); } catch { setError("save"); } finally { setBusy(false); } };

  return <div className="wk-navrail__quick-mute-wrap">
    <button ref={triggerRef} type="button" className="wk-navrail__item wk-navrail__quick-mute-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => open ? closePopover() : setOpen(true)} title={state.active ? t("base.navRail.settingsCenter.value.muted") : t("base.navRail.settingsCenter.value.remindersOn")}>
      <BellIcon muted={state.active} /><span className="wk-navrail__item-label">{state.active ? t("base.navRail.settingsCenter.value.muted") : t("base.navRail.settingsCenter.value.remindersOn")}</span>
    </button>
    <NavFlyout open={open} triggerRef={triggerRef} onOpenChange={(nextOpen) => nextOpen ? setOpen(true) : closePopover()} size="md" role="menu" ariaLabel={t("base.navRail.quickMute.menuTitle")} className="wk-navrail__quick-mute-menu">
      <div className="wk-navrail__quick-mute-title">{t("base.navRail.quickMute.menuTitle")}</div>
      <div className="wk-navrail__quick-mute-hint">{t("base.navRail.quickMute.menuHint")}</div>
      <button type="button" role="menuitem" disabled={busy || !loaded} className="wk-navrail__quick-mute-option" onClick={() => void apply("manual")}>{t("base.navRail.settingsCenter.action.muteManual")}</button>
      <button type="button" role="menuitem" disabled={busy || !loaded} className="wk-navrail__quick-mute-option" onClick={() => void apply("30m")}>{t("base.navRail.settingsCenter.action.mute30m")}</button>
      <button type="button" role="menuitem" disabled={busy || !loaded} className="wk-navrail__quick-mute-option" onClick={() => void apply("1h")}>{t("base.navRail.settingsCenter.action.mute1h")}</button>
      <button type="button" role="menuitem" disabled={busy || !loaded} className="wk-navrail__quick-mute-option" onClick={() => setCustomOpen((visible) => !visible)}>{t("base.navRail.quickMute.chooseDateTime")}</button>
      {customOpen && <div className="wk-navrail__quick-mute-custom"><input type="datetime-local" value={customTime} min={formatLocalDateTime(new Date())} onChange={(event) => setCustomTime(event.target.value)} aria-label={t("base.navRail.settingsCenter.row.customMuteTime")} /><button type="button" disabled={busy || !loaded} onClick={() => void apply("custom")}>{t("base.navRail.settingsCenter.action.muteUntil")}</button></div>}
      {state.active && <button type="button" role="menuitem" disabled={busy || !loaded} className="wk-navrail__quick-mute-resume" onClick={() => void resume()}>{t("base.navRail.settingsCenter.action.resume")}</button>}
      {error && <div className="wk-navrail__quick-mute-error" role="alert">{t(error === "load" ? "base.navRail.settingsCenter.value.loadFailed" : "base.navRail.settingsCenter.value.saveFailed")} <button type="button" onClick={() => error === "load" ? void loadState() : lastAction === "resume" ? void resume() : void apply(lastAction)}>{t("base.navRail.settingsCenter.action.retry")}</button></div>}
    </NavFlyout>
  </div>;
}
