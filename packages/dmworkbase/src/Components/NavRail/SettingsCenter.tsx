import React, { useMemo, useRef, useState } from "react";
import { t } from "../../i18n";
import WKModal from "../WKModal";
import "./SettingsCenter.css";
import { detectRuntimeEnvironment, type RuntimeEnvironment } from "../../Runtime";
import { getAvailableSettingsGroups, type SettingsItem } from "./settingsRegistry";
import { SettingsPage } from "./settingsPages";
import SecretsSettingsPanel from "../SecretsSettings/SecretsSettingsPanel";

export interface OpenSecretsRequest {
  create?: boolean;
  name?: string;
  value?: string;
  sequence: number;
}

export interface SettingsCenterProps {
  visible: boolean;
  isDesktop?: boolean;
  environment?: RuntimeEnvironment;
  hasAccountCenter?: boolean;
  accountCenterUrl?: string;
  onClose: () => void;
  onLogout?: () => void;
  onSecretsClosed?: () => void;
  onAbout?: () => void;
  onChangelog?: () => void;
  onOpenOnboarding?: () => void;
  openSecretsRequest?: OpenSecretsRequest | null;
}
function SettingsIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    general: <><path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" /></>,
    account: <><circle cx="12" cy="8" r="5" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
    notifications: <><path d="M10.268 21a2 2 0 0 0 3.464 0" /><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" /></>,
    voice: <><path d="M12 19v3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><rect x="9" y="2" width="6" height="13" rx="3" /></>,
    "desktop-behavior": <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M10 4v4" /><path d="M2 8h20" /><path d="M6 4v4" /></>,
    downloads: <><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 0 2 2v2" /></>,
    shortcuts: <><path d="M10 8h.01" /><path d="M12 12h.01" /><path d="M14 8h.01" /><path d="M16 12h.01" /><path d="M18 8h.01" /><path d="M6 8h.01" /><path d="M7 16h10" /><path d="M8 12h.01" /><rect width="20" height="16" x="2" y="4" rx="2" /></>,
    devices: <><path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8" /><path d="M10 19v-3.96 3.15" /><path d="M7 19h5" /><rect width="6" height="10" x="16" y="12" rx="2" /></>,
    about: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] ?? paths.general}</svg>;
}
function LogoutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /></svg>;
}
export default function SettingsCenter({ visible, isDesktop = false, environment, accountCenterUrl, onClose, onLogout, onSecretsClosed, onAbout, onChangelog, onOpenOnboarding, openSecretsRequest }: SettingsCenterProps) {
  const runtimeEnvironment = React.useMemo(() => environment ?? detectRuntimeEnvironment(isDesktop), [environment, isDesktop]);
  const availableGroups = useMemo(
    () => getAvailableSettingsGroups({ environment: runtimeEnvironment }),
    [runtimeEnvironment],
  );
  const [selectedId, setSelectedId] = useState("general");
  const [secondaryPage, setSecondaryPage] = useState<"secrets" | null>(null);
  const previousSecondaryPage = useRef<"secrets" | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [selectedId, secondaryPage, visible]);
  React.useEffect(() => {
    if (previousSecondaryPage.current === "secrets" && secondaryPage === null) onSecretsClosed?.();
    previousSecondaryPage.current = secondaryPage;
  }, [onSecretsClosed, secondaryPage]);
  React.useEffect(() => {
    if (openSecretsRequest) {
      setSelectedId("account");
      setSecondaryPage("secrets");
    }
  }, [openSecretsRequest]);
  React.useEffect(() => {
    if (!visible) {
      setSelectedId("general");
      setSecondaryPage(null);
    }
  }, [visible]);
  const selected = availableGroups.flatMap((group) => group.items).find((item) => item.id === selectedId) ?? availableGroups[0]?.items[0];
  return <WKModal visible={visible} onCancel={onClose} width="min(1080px, calc(100vw - 48px))" className="wk-settings-center-modal" bodyStyle={{ padding: 0 }} options={{ maskClosable: true }}><div className="wk-settings-center" data-testid="settings-center"><button type="button" className="wk-settings-center__close" aria-label={t("base.common.close")} onClick={onClose} /><aside className="wk-settings-center__sidebar" aria-label={t("base.navRail.settingsCenter.navigation")}><h1>{t("base.navRail.settingsCenter.title")}</h1><nav className="wk-settings-center__navigation">{availableGroups.map((group) => <section className="wk-settings-center__group" key={group.titleKey}><h2>{t(group.titleKey)}</h2><div className="wk-settings-center__nav-list">{group.items.map((item) => <button type="button" key={item.id} data-testid={`settings-center-nav-${item.id}`} className={`wk-settings-center__nav-item${item.id === selectedId ? " is-active" : ""}`} aria-current={item.id === selectedId ? "page" : undefined} onClick={() => { setSecondaryPage(null); setSelectedId(item.id); }}><SettingsIcon name={item.id} /><span>{t(item.labelKey)}</span></button>)}</div></section>)}</nav><div className="wk-settings-center__footer">{onLogout && <button type="button" className="is-danger" data-testid="settings-center-logout" onClick={onLogout}><LogoutIcon /><span>{t("base.navRail.settingsPanel.logout")}</span></button>}</div></aside><main ref={contentRef} className="wk-settings-center__content" data-testid="settings-center-content">{secondaryPage === "secrets" ? <div className="wk-settings-center__secondary-page"><button type="button" className="wk-settings-center__back" data-testid="settings-center-secondary-back" onClick={() => setSecondaryPage(null)}>← {t("base.common.back")}</button><SecretsSettingsPanel key={openSecretsRequest?.sequence ?? "embedded"} embedded onClose={() => setSecondaryPage(null)} initialCreate={openSecretsRequest?.create} prefillName={openSecretsRequest?.name} prefillValue={openSecretsRequest?.value} /></div> : <SettingsPage item={selected} environment={runtimeEnvironment} accountCenterUrl={accountCenterUrl} onSecrets={() => setSecondaryPage("secrets")} onAbout={onAbout} onChangelog={onChangelog} onOpenOnboarding={onOpenOnboarding} />}</main></div></WKModal>;
}
