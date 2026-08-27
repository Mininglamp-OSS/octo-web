import React, { useMemo, useRef, useState } from "react";
import { Bell, FolderDown, Info, Keyboard, LogOut, Mic, Monitor, MonitorSmartphone, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import { t } from "../../i18n";
import "./SettingsCenter.css";
import { detectRuntimeEnvironment, type RuntimeEnvironment } from "../../Runtime";
import { getAvailableSettingsGroups, type SettingsItem } from "./settingsRegistry";
import { getVoiceOs, SettingsPage } from "./settingsPages";
import type { AboutUpdateStatus } from "./settingsPages";
import SecretsSettingsPanel from "../SecretsSettings/SecretsSettingsPanel";
import { shouldShowVoiceShortcuts, voiceSettingsStore } from "../../Service/VoiceSettingsStore";
import { Modal as OctoModal } from "@octo/ui";

const settingsIcons = { general: SlidersHorizontal, account: UserRound, notifications: Bell, voice: Mic, "desktop-behavior": Monitor, downloads: FolderDown, "trusted-domains": ShieldCheck, shortcuts: Keyboard, devices: MonitorSmartphone, about: Info } as const;

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
  aboutUpdateStatus?: AboutUpdateStatus;
  onOpenOnboarding?: () => void;
  openSecretsRequest?: OpenSecretsRequest | null;
}
function SettingsIcon({ name }: { name: string }) {
  const Icon = settingsIcons[name as keyof typeof settingsIcons] ?? SlidersHorizontal;
  return <Icon aria-hidden="true" />;
}
function LogoutIcon() {
  return <LogOut aria-hidden="true" />;
}
export default function SettingsCenter({ visible, isDesktop = false, environment, accountCenterUrl, onClose, onLogout, onSecretsClosed, onAbout, aboutUpdateStatus, onOpenOnboarding, openSecretsRequest }: SettingsCenterProps) {
  const runtimeEnvironment = React.useMemo(() => environment ?? detectRuntimeEnvironment(isDesktop), [environment, isDesktop]);
  const [voiceSettings, setVoiceSettings] = React.useState(() => voiceSettingsStore.get());
  React.useEffect(() => voiceSettingsStore.subscribe(setVoiceSettings), []);
  const availableGroups = useMemo(
    () => getAvailableSettingsGroups({ environment: runtimeEnvironment }).map((group) => ({
      ...group,
      items: group.items.filter((item) => item.id !== "shortcuts" || shouldShowVoiceShortcuts(voiceSettings, getVoiceOs(runtimeEnvironment))),
    })).filter((group) => group.items.length > 0),
    [runtimeEnvironment, voiceSettings],
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
    if (visible && openSecretsRequest) {
      setSelectedId("account");
      setSecondaryPage("secrets");
    }
  }, [openSecretsRequest, visible]);
  React.useEffect(() => {
    if (!visible && !openSecretsRequest) {
      setSelectedId("general");
      setSecondaryPage(null);
    }
  }, [openSecretsRequest, visible]);
  React.useEffect(() => {
    if (selectedId === "shortcuts" && !shouldShowVoiceShortcuts(voiceSettings, getVoiceOs(runtimeEnvironment))) {
      setSelectedId(availableGroups[0]?.items[0]?.id ?? "general");
    }
  }, [availableGroups, runtimeEnvironment.os, selectedId, voiceSettings]);
  const selected = availableGroups.flatMap((group) => group.items).find((item) => item.id === selectedId) ?? availableGroups[0]?.items[0];
  return <OctoModal visible={visible} onCancel={onClose} width="min(1080px, calc(100vw - 48px))" className="wk-settings-center-modal" bodyStyle={{ padding: 0 }} header={null} options={{ maskClosable: true }}><div className="wk-settings-center" data-testid="settings-center"><button type="button" className="wk-settings-center__close" aria-label={t("base.common.close")} onClick={onClose} /><aside className="wk-settings-center__sidebar" aria-label={t("base.navRail.settingsCenter.navigation")}><h1>{t("base.navRail.settingsCenter.title")}</h1><nav className="wk-settings-center__navigation">{availableGroups.map((group) => <section className="wk-settings-center__group" key={group.titleKey}><h2>{t(group.titleKey)}</h2><div className="wk-settings-center__nav-list">{group.items.map((item) => <button type="button" key={item.id} data-testid={`settings-center-nav-${item.id}`} className={`wk-settings-center__nav-item${item.id === selectedId ? " is-active" : ""}`} aria-current={item.id === selectedId ? "page" : undefined} onClick={() => { setSecondaryPage(null); setSelectedId(item.id); }}><SettingsIcon name={item.id} /><span>{t(item.labelKey)}</span></button>)}</div></section>)}</nav><div className="wk-settings-center__footer">{onLogout && <button type="button" className="is-danger" data-testid="settings-center-logout" onClick={onLogout}><LogoutIcon /><span>{t("base.navRail.settingsPanel.logout")}</span></button>}</div></aside><main ref={contentRef} className="wk-settings-center__content" data-testid="settings-center-content">{secondaryPage === "secrets" ? <div className="wk-settings-center__secondary-page"><button type="button" className="wk-settings-center__back" data-testid="settings-center-secondary-back" onClick={() => setSecondaryPage(null)}>← {t("base.common.back")}</button><SecretsSettingsPanel key={openSecretsRequest?.sequence ?? "embedded"} embedded onClose={() => setSecondaryPage(null)} initialCreate={openSecretsRequest?.create} prefillName={openSecretsRequest?.name} prefillValue={openSecretsRequest?.value} /></div> : <SettingsPage item={selected} environment={runtimeEnvironment} accountCenterUrl={accountCenterUrl} onSecrets={() => setSecondaryPage("secrets")} onAbout={onAbout} aboutUpdateStatus={aboutUpdateStatus} onOpenOnboarding={onOpenOnboarding} />}</main></div></OctoModal>;
}
