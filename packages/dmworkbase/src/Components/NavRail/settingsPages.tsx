import React, { useState } from "react";
import { Checkbox, Switch } from "@octo/ui";
import { ChevronRight, ExternalLink } from "lucide-react";
import { Spin, Toast } from "@douyinfe/semi-ui";
import DOMPurify from "dompurify";
import { QRCodeSVG } from "qrcode.react";
import WKApp, { ThemeMode } from "../../App";
import { apiFetchJson } from "../../Service/apiFetch";
import { useMobileDownloadUrl } from "../../Service/mobileDownloadUpdater";
import { updateUserLanguagePreference } from "../../Service/UserLanguageService";
import { i18n, t } from "../../i18n";
import { Locale } from "../../i18n/types";
import type { SettingsItem } from "./settingsRegistry";
import { createDesktopSettingsAdapter, createDownloadSettingsAdapter, createKeepAwakeAdapter, createNotificationAdapter, type DesktopSettings, type DownloadSettings } from "../../Runtime/adapters";
import SettingsStatusTag from "./SettingsStatusTag";
import { MeInfo } from "../MeInfo";
import octoLogo from "../../assets/settings-center/octo-logo.png";
import mininglampLogo from "../../assets/settings-center/mininglamp-logo.png";
import { quickMuteStore } from "./QuickMuteStore";
import { getMicrophonePermission, getVoiceShortcut, getVoiceShortcutLabelKey, shouldShowVoiceShortcuts, setMicrophonePermission, VOICE_PROTOCOL_VERSION, VOICE_SETTINGS_DEFAULTS, voiceSettingsStore, type VoiceSettings, type VoiceShortcut } from "../../Service/VoiceSettingsStore";
import { getDocument } from "../../Service/DocumentService";
import { acceptVoiceInput } from "../../features/voice-input/useSpaceFeedbackSetting";
import { Dap } from "../../Service/Dap";
import { getElectronLinksBridge, openElectronSystemSettings } from "../../electron/desktopBridge";
import { resolveWebOrigin } from "../../Utils/webOrigin";
import type { VersionCheckResult } from "../../Utils/versionChecker";

export function SettingsRow({ title, description, trailing, children }: { title: string; description?: React.ReactNode; trailing?: React.ReactNode; children?: React.ReactNode }) { return <div className="wk-settings-center__row"><div className="wk-settings-center__row-main"><div className="wk-settings-center__row-title">{title}</div>{description && <div className="wk-settings-center__row-description">{description}</div>}</div>{children ?? trailing}</div>; }

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="wk-settings-center__settings-section"><h3>{title}</h3>{children}</section>; }

export type ResourceStatus = "available" | "unavailable" | "coming-soon";
export type AboutUpdateStatus = { status: Extract<VersionCheckResult["status"], "latest" | "update" | "failed" | "skipped">; version?: string };
type ResourceDefinition = {
  id: string;
  titleKey: string;
  descriptionKey: string;
  status: ResourceStatus;
  url?: string;
  actionKey?: string;
};
type ResourceGroup = { titleKey: string; category: "clients" | "resources"; resources: ResourceDefinition[] };

export const settingsResourceGroups: ResourceGroup[] = [
  {
    titleKey: "base.navRail.settingsCenter.resource.mobile",
    category: "clients",
    resources: [
      { id: "android", titleKey: "base.navRail.settingsCenter.resource.android", descriptionKey: "base.navRail.settingsCenter.resource.androidDescription", status: "available", url: "https://github.com/Mininglamp-OSS/octo-android/releases/latest", actionKey: "base.navRail.settingsCenter.action.download" },
      { id: "iphone", titleKey: "base.navRail.settingsCenter.resource.iphone", descriptionKey: "base.navRail.settingsCenter.resource.iosDescription", status: "coming-soon", actionKey: "base.navRail.settingsCenter.action.download" },
    ],
  },
  {
    titleKey: "base.navRail.settingsCenter.resource.desktop",
    category: "clients",
    resources: [
      { id: "windows", titleKey: "base.navRail.settingsCenter.resource.windows", descriptionKey: "base.navRail.settingsCenter.resource.windowsDescription", status: "coming-soon" },
      { id: "macos", titleKey: "base.navRail.settingsCenter.resource.macos", descriptionKey: "base.navRail.settingsCenter.resource.macosDescription", status: "coming-soon" },
    ],
  },
  {
    titleKey: "base.navRail.settingsCenter.resource.extensions",
    category: "resources",
    resources: [
      { id: "chrome", titleKey: "base.navRail.settingsCenter.resource.chrome", descriptionKey: "base.navRail.settingsCenter.resource.chromeDescription", status: "available", url: "https://chromewebstore.google.com/detail/octo-%E6%8F%92%E4%BB%B6%E7%89%88/nemameogpfkponoomeblkjcnbidgmndk", actionKey: "base.navRail.settingsCenter.action.install" },
      { id: "openclaw", titleKey: "base.navRail.settingsCenter.resource.openclaw", descriptionKey: "base.navRail.settingsCenter.resource.openclawDescription", status: "available", url: "https://github.com/Mininglamp-OSS/openclaw-channel-octo", actionKey: "base.navRail.settingsCenter.action.viewProject" },
    ],
  },
];

const mobileUpdaterPaths: Record<string, string> = {
  android: "common/updater/android/1.0",
  iphone: "common/updater/ios/1.0.0",
};

const fetchMobileUpdater = (url: string, init?: RequestInit) => apiFetchJson(url, init);

export function SettingsPage({ item, environment, accountCenterUrl, onSecrets, onAbout, aboutUpdateStatus, onOpenOnboarding }: { item?: SettingsItem; environment: import("../../Runtime").RuntimeEnvironment; accountCenterUrl?: string; onSecrets?: () => void; onAbout?: () => void; aboutUpdateStatus?: AboutUpdateStatus; onOpenOnboarding?: () => void }) {
  if (item?.id === "general") return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.general.title")}><SettingsSection title={t("base.navRail.settingsCenter.section.displayLanguage")}><SettingsRow title={t("base.navRail.settingsCenter.row.language")} description={t("base.navRail.settingsCenter.row.languageDescription")} trailing={<select className="wk-settings-center__demo-select" aria-label={t("base.navRail.settingsCenter.row.language")} value={i18n.getLocale()} onChange={(event) => { const locale = event.target.value as Locale; i18n.setLocale(locale); if (WKApp.shared.isLogined()) void updateUserLanguagePreference(locale).catch(() => Toast.error(t("base.navRail.settingsCenter.value.saveFailed"))); }}><option value="zh-CN">{t("base.navRail.settingsCenter.language.zh")}</option><option value="en-US">{t("base.navRail.settingsCenter.language.en")}</option></select>} /><SettingsRow title={t("base.navRail.settingsCenter.row.darkMode")} description={t("base.navRail.settingsCenter.row.darkModeDescription")} trailing={<SettingsStatusTag tone="neutral" label={t("base.navRail.settingsCenter.value.comingSoon")} />} /></SettingsSection></SettingsPageFrame>;
  if (item?.id === "account") return <AccountSettingsPage accountCenterUrl={accountCenterUrl} onSecrets={onSecrets} />;
  if (item?.id === "notifications") {
    return <NotificationsSettingsPage environment={environment} />;
  }
  if (item?.id === "desktop-behavior") return <DesktopBehaviorSettingsPage environment={environment} />;
  if (item?.id === "downloads") return <DownloadsSettingsPage environment={environment} />;
  if (item?.id === "voice") return <VoiceInputSettingsPage environment={environment} />;
  if (item?.id === "shortcuts") return <ShortcutsSettingsPage environment={environment} />;
  if (item?.id === "devices") return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.devices.title")} description={t("base.navRail.settingsCenter.page.devices.description")}><div className="wk-settings-center__resource-sections">{settingsResourceGroups.map((group) => <ResourceSection key={group.titleKey} title={t(group.titleKey)} category={group.category}>{group.resources.map((resource) => <ResourceCard key={resource.id} {...resource} title={t(resource.titleKey)} description={t(resource.descriptionKey)} category={group.category} action={resource.url && resource.actionKey ? <a className={`wk-settings-center__resource-action${group.category === "clients" ? " wk-settings-center__resource-action--client" : ""}`} href={resource.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{t(resource.actionKey)}</a> : undefined} />)}</ResourceSection>)}</div></SettingsPageFrame>;
  if (item?.id === "about") return <AboutSettingsPage environment={environment} onAbout={onAbout} aboutUpdateStatus={aboutUpdateStatus} onOpenOnboarding={onOpenOnboarding} />;
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.fallback.title")} description={t("base.navRail.settingsCenter.page.fallback.description")}><SettingsRow title={t("base.navRail.settingsCenter.row.placeholder")} description={t("base.navRail.settingsCenter.placeholder")} /></SettingsPageFrame>;
}

function DownloadsSettingsPage({ environment }: { environment: import("../../Runtime").RuntimeEnvironment }) {
  const adapter = React.useMemo(() => createDownloadSettingsAdapter(environment), [environment]);
  const [settings, setSettings] = React.useState<DownloadSettings | null>(null);
  const [saving, setSaving] = useState(false);
  React.useEffect(() => { let active = true; if (!adapter) return () => { active = false; }; void adapter.get().then((next) => { if (active) setSettings(next); }).catch(() => undefined); return () => { active = false; }; }, [adapter]);
  const update = async (patch: Pick<DownloadSettings, "askBeforeSaving">) => { if (!adapter) return; setSaving(true); try { setSettings(await adapter.set(patch)); } catch { Toast.error(t("base.navRail.settingsCenter.value.saveFailed")); } finally { setSaving(false); } };
  const choose = async () => { if (!adapter) return; setSaving(true); try { setSettings(await adapter.chooseDirectory()); } catch { Toast.error(t("base.navRail.settingsCenter.value.saveFailed")); } finally { setSaving(false); } };
  const unavailable = <SettingsStatusTag tone="neutral" label={t("base.navRail.settingsCenter.value.comingSoon")} />;
  const directory = settings?.directory ?? t(environment.os === "macos" ? "base.navRail.settingsCenter.value.defaultDownloadPathMacos" : "base.navRail.settingsCenter.value.defaultDownloadPathWindows");
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.downloads.title")}><SettingsSection title={t("base.navRail.settingsCenter.section.downloads")}><SettingsRow title={t("base.navRail.settingsCenter.row.downloadDirectory")} description={<><span>{t("base.navRail.settingsCenter.row.downloadDirectoryDescription")}</span><code className="wk-settings-center__download-path">{directory}</code></>} trailing={settings ? <button type="button" className="wk-settings-center__manage-button" disabled={saving} onClick={() => { void choose(); }}>{t("base.navRail.settingsCenter.action.change")}</button> : unavailable} /><SettingsRow title={t("base.navRail.settingsCenter.row.askBeforeSaving")} description={t("base.navRail.settingsCenter.row.askBeforeSavingDescription")} trailing={settings ? <Switch disabled={saving} checked={settings.askBeforeSaving} onChange={(checked) => { void update({ askBeforeSaving: checked }); }} aria-label={t("base.navRail.settingsCenter.row.askBeforeSaving")} /> : unavailable} /></SettingsSection></SettingsPageFrame>;
}

function ShortcutsSettingsPage({ environment }: { environment: import("../../Runtime").RuntimeEnvironment }) {
  const settings = useVoiceSettings();
  const os = getVoiceOs(environment);
  if (!shouldShowVoiceShortcuts(settings, os)) return null;
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.shortcuts.title")}><div className="wk-settings-center__shortcut-catalog"><section className="wk-settings-center__shortcut-group"><h3>{t("base.navRail.settingsCenter.shortcut.voice")}</h3><ShortcutRow label={t("base.navRail.settingsCenter.shortcut.holdToTalk")} keys={[t(getVoiceShortcutLabelKey(getVoiceShortcut(settings, os), os)), voiceModeLabel(settings.speakingMode)]} /><ShortcutRow label={t("base.navRail.settingsCenter.shortcut.cancelVoice")} keys={["Esc"]} /></section></div></SettingsPageFrame>;
}

function AccountSettingsPage({ accountCenterUrl, onSecrets }: { accountCenterUrl?: string; onSecrets?: () => void }) {
  const [, setRealnameVerified] = React.useState(() => WKApp.loginInfo.realnameVerified === true);
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.account.title")}><>{accountCenterUrl && <SettingsSection title={t("base.navRail.settingsCenter.section.accountSecurity")}><SettingsRow title={t("base.navRail.settingsCenter.row.accountCenter")} description={t("base.navRail.settingsCenter.row.accountCenterDescription")} trailing={<a className="wk-settings-center__external-link" href={accountCenterUrl} target="_blank" rel="noreferrer" aria-label={t("base.navRail.settingsCenter.row.accountCenter")}><ExternalLink aria-hidden="true" /></a>} /></SettingsSection>}<SettingsSection title={t("base.navRail.settingsCenter.section.profile")}><MeInfo onClose={() => undefined} embedded onRealnameStatusChange={setRealnameVerified} /></SettingsSection><SettingsSection title={t("base.navRail.settingsCenter.section.secrets")}><SettingsRow title={t("base.navRail.settingsCenter.row.manageSecrets")} description={t("base.navRail.settingsCenter.row.manageSecretsDescription")} trailing={<button type="button" className="wk-settings-center__manage-button" onClick={onSecrets}>{t("base.navRail.settingsCenter.action.manage")}</button>} /><SettingsRow title={t("base.navRail.settingsCenter.row.referenceSecrets")} description={t("base.navRail.settingsCenter.row.referenceSecretsDescription")} /></SettingsSection></></SettingsPageFrame>;
}

function DesktopBehaviorSettingsPage({ environment }: { environment: import("../../Runtime").RuntimeEnvironment }) {
  const desktopSettingsAdapter = React.useMemo(() => createDesktopSettingsAdapter(environment), [environment]);
  const [desktopSettings, setDesktopSettings] = React.useState<DesktopSettings | null>(null);
  const [desktopSettingsSaving, setDesktopSettingsSaving] = useState(false);
  const keepAwakeAdapter = React.useMemo(() => createKeepAwakeAdapter(environment), [environment]);
  const [keepAwake, setKeepAwake] = useState(false);
  const [keepAwakeLoading, setKeepAwakeLoading] = useState(Boolean(keepAwakeAdapter));
  const [keepAwakeSaving, setKeepAwakeSaving] = useState(false);

  React.useEffect(() => {
    let active = true;
    if (!keepAwakeAdapter) {
      setKeepAwakeLoading(false);
      return () => { active = false; };
    }
    void keepAwakeAdapter.getEnabled().then((enabled) => {
      if (active) {
        setKeepAwake(enabled);
        setKeepAwakeLoading(false);
      }
    }).catch(() => {
      if (active) setKeepAwakeLoading(false);
    });
    return () => { active = false; };
  }, [keepAwakeAdapter]);

  const updateKeepAwake = async (enabled: boolean) => {
    if (!keepAwakeAdapter) return;
    setKeepAwakeSaving(true);
    try {
      setKeepAwake(await keepAwakeAdapter.setEnabled(enabled));
    } catch {
      Toast.error(t("base.navRail.settingsCenter.value.keepAwakeSaveFailed"));
    } finally {
      setKeepAwakeSaving(false);
    }
  };

  React.useEffect(() => {
    let active = true;
    if (!desktopSettingsAdapter) return () => { active = false; };
    void desktopSettingsAdapter.get().then((next) => { if (active) setDesktopSettings(next); }).catch(() => undefined);
    return () => { active = false; };
  }, [desktopSettingsAdapter]);

  const updateDesktopSettings = async (patch: Partial<DesktopSettings>) => {
    if (!desktopSettingsAdapter) return;
    setDesktopSettingsSaving(true);
    try { setDesktopSettings(await desktopSettingsAdapter.set(patch)); }
    catch { Toast.error(t("base.navRail.settingsCenter.value.saveFailed")); }
    finally { setDesktopSettingsSaving(false); }
  };

  const os = environment.os === "macos" ? "macos" : "windows";
  const supportsSystemLifecycle = environment.os !== "linux";
  const canConfigureWindowsBackground = environment.os !== "windows" || desktopSettings?.showOnTray !== false;
  const unavailable = <SettingsStatusTag tone="neutral" label={t("base.navRail.settingsCenter.value.comingSoon")} />;
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.desktopBehavior.title")}>
    <SettingsSection title={t("base.navRail.settingsCenter.section.display")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.interfaceScale")} description={t("base.navRail.settingsCenter.row.interfaceScaleDescription")} trailing={desktopSettings ? <select className="wk-settings-center__demo-select" value={String(desktopSettings.zoomFactor)} disabled={desktopSettingsSaving} onChange={(event) => { void updateDesktopSettings({ zoomFactor: Number(event.target.value) }); }} aria-label={t("base.navRail.settingsCenter.row.interfaceScale")}><option value="0.8">80%</option><option value="0.9">90%</option><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option></select> : unavailable} />
    </SettingsSection>
    <SettingsSection title={t("base.navRail.settingsCenter.section.system")}>
      <SettingsRow title={t(os === "macos" ? "base.navRail.settingsCenter.row.launchAtLogin" : "base.navRail.settingsCenter.row.launchAtStartup")} description={t(os === "macos" ? "base.navRail.settingsCenter.row.launchAtLoginDescription" : "base.navRail.settingsCenter.row.launchAtStartupDescription")} trailing={desktopSettings && supportsSystemLifecycle ? <Switch disabled={desktopSettingsSaving} checked={desktopSettings.launchAtLogin} onChange={(checked) => { void updateDesktopSettings({ launchAtLogin: checked }); }} aria-label={t(os === "macos" ? "base.navRail.settingsCenter.row.launchAtLogin" : "base.navRail.settingsCenter.row.launchAtStartup")} /> : unavailable} />
      <SettingsRow title={t(os === "macos" ? "base.navRail.settingsCenter.row.menuBar" : "base.navRail.settingsCenter.row.systemTray")} description={t(os === "macos" ? "base.navRail.settingsCenter.row.menuBarDescription" : "base.navRail.settingsCenter.row.systemTrayDescription")} trailing={desktopSettings && supportsSystemLifecycle ? <Switch disabled={desktopSettingsSaving} checked={desktopSettings.showOnTray} onChange={(checked) => { void updateDesktopSettings({ showOnTray: checked }); }} aria-label={t(os === "macos" ? "base.navRail.settingsCenter.row.menuBar" : "base.navRail.settingsCenter.row.systemTray")} /> : unavailable} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.keepAwake")} description={t("base.navRail.settingsCenter.row.keepAwakeDescription")} trailing={keepAwakeAdapter ? <Switch disabled={keepAwakeLoading || keepAwakeSaving} checked={keepAwake} onChange={(checked) => { void updateKeepAwake(checked); }} aria-label={t("base.navRail.settingsCenter.row.keepAwake")} /> : unavailable} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.closeWindowBehavior")} description={t("base.navRail.settingsCenter.row.closeWindowBehaviorDescription")} trailing={desktopSettings && supportsSystemLifecycle && canConfigureWindowsBackground ? <select className="wk-settings-center__demo-select" value={desktopSettings.closeBehavior} disabled={desktopSettingsSaving} onChange={(event) => { void updateDesktopSettings({ closeBehavior: event.target.value as DesktopSettings["closeBehavior"] }); }} aria-label={t("base.navRail.settingsCenter.row.closeWindowBehavior")}><option value="background">{t("base.navRail.settingsCenter.value.continueInBackground")}</option><option value="quit">{t("base.navRail.settingsCenter.value.quitOcto")}</option></select> : unavailable} />
    </SettingsSection>
  </SettingsPageFrame>;
}

function NotificationsSettingsPage({ environment }: { environment: import("../../Runtime").RuntimeEnvironment }) {
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => !WKApp.shared.notificationIsClose);
  const notificationAdapter = React.useMemo(() => createNotificationAdapter(environment), [environment]);
  const [muteScope, setMuteScope] = useState<"sound" | "sound-and-popup">("sound-and-popup");
  const [permission, setPermission] = useState(() => notificationAdapter.getPermission());
  const isDesktop = environment.target === "desktop";
  const permissionLabel = permission === "unsupported" ? t("base.navRail.settingsCenter.value.unsupported") : permission === "managed" ? t("base.navRail.settingsCenter.value.systemManaged") : permission === "denied" ? t("base.navRail.settingsCenter.value.denied") : permission === "granted" ? t("base.navRail.settingsCenter.value.granted") : t("base.navRail.settingsCenter.value.unauthorized");
  const permissionTone: "success" | "attention" | "danger" | "neutral" = permission === "granted" ? "success" : permission === "denied" ? "danger" : permission === "default" ? "attention" : "neutral";
  const requestPermission = async () => {
    try { setPermission(await notificationAdapter.requestPermission()); }
    catch { Toast.error(t("base.navRail.settingsCenter.value.saveFailed")); }
  };
  const openNotificationSettings = async () => {
    if (environment.target !== "desktop") return;
    const opened = await openElectronSystemSettings("notifications").catch(() => false);
    if (!opened) Toast.info(t("base.navRail.settingsCenter.row.systemPermissionDesktopDescription"));
  };
  React.useEffect(() => {
    let mounted = true;
    void quickMuteStore.getState().then((next) => { if (mounted) setMuteScope(next.scope); }).catch(() => undefined);
    const unsubscribe = quickMuteStore.subscribe((next) => { if (mounted) setMuteScope(next.scope); });
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.notifications.title")}>
    <SettingsSection title={t("base.navRail.settingsCenter.section.quickMute")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.muteScope")} description={t("base.navRail.settingsCenter.row.muteScopeDescription")} trailing={<select className="wk-settings-center__demo-select" aria-label={t("base.navRail.settingsCenter.row.muteScope")} value={muteScope} onChange={(event) => quickMuteStore.setScope(event.target.value as typeof muteScope)}><option value="sound">{t("base.navRail.settingsCenter.value.soundOnly")}</option><option value="sound-and-popup">{t("base.navRail.settingsCenter.value.soundAndPopup")}</option></select>} />
    </SettingsSection>
    <SettingsSection title={t("base.navRail.settingsCenter.section.desktopSystemNotifications")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.notificationOptions")} description={isDesktop ? t("base.navRail.settingsCenter.row.notificationOptionsDesktopDescription") : t("base.navRail.settingsCenter.row.notificationOptionsWebDescription")} trailing={<Switch checked={notificationsEnabled} onChange={(checked) => { setNotificationsEnabled(checked); WKApp.shared.notificationIsClose = !checked; }} aria-label={t("base.navRail.settingsCenter.row.notificationOptions")} />} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.systemPermission")} description={isDesktop ? t("base.navRail.settingsCenter.row.systemPermissionDesktopDescription") : t("base.navRail.settingsCenter.row.systemPermissionWebDescription")} trailing={<span className="wk-settings-center__row-actions"><SettingsStatusTag tone={permissionTone} label={permissionLabel} />{permission === "default" && <button type="button" className="wk-settings-center__manage-button" onClick={() => { void requestPermission(); }}>{t("base.navRail.settingsCenter.action.authorize")}</button>}{isDesktop && (permission === "denied" || permission === "managed") && <button type="button" className="wk-settings-center__manage-button" onClick={() => { void openNotificationSettings(); }}>{t("base.navRail.settingsCenter.action.openSystemSettings")}</button>}</span>} />
    </SettingsSection>
  </SettingsPageFrame>;
}
function SettingsPageFrame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <div className="wk-settings-center__page"><header className="wk-settings-center__page-header"><h2>{title}</h2>{description && <p>{description}</p>}</header><section className="wk-settings-center__section-content">{children}</section></div>; }
function AboutSettingsPage({ environment, onAbout, aboutUpdateStatus = { status: "skipped" }, onOpenOnboarding }: { environment: import("../../Runtime").RuntimeEnvironment; onAbout?: () => void; aboutUpdateStatus?: AboutUpdateStatus; onOpenOnboarding?: () => void }) {
  const productManualUrl = "/product-docs";
  const runtimeLabel = t(environment.target === "desktop" ? "base.navRail.settingsCenter.about.desktop" : "base.navRail.settingsCenter.about.web");
  const platformKey = environment.os === "macos" ? "base.navRail.settingsCenter.about.macos" : environment.os === "windows" ? "base.navRail.settingsCenter.about.windows" : environment.os === "linux" ? "base.navRail.settingsCenter.about.linux" : undefined;
  const platformLabel = platformKey ? t(platformKey) : "";
  const isDesktop = environment.target === "desktop";
  const updateAvailable = aboutUpdateStatus.status === "update";
  const statusTone = aboutUpdateStatus.status === "failed" ? "danger" : updateAvailable ? "attention" : aboutUpdateStatus.status === "latest" ? "success" : "neutral";
  const statusLabel = aboutUpdateStatus.status === "failed" ? t("base.navRail.settingsCenter.value.updateCheckFailed") : updateAvailable ? t("base.navRail.settingsCenter.value.updateAvailable") : aboutUpdateStatus.status === "latest" ? t("base.navRail.settingsCenter.value.latestVersion") : t("base.navRail.settingsCenter.value.updateNotChecked");
  const updateDescription = updateAvailable && aboutUpdateStatus.version
    ? t("base.navRail.settingsCenter.about.updateAvailableDescription", { values: { version: aboutUpdateStatus.version } })
    : aboutUpdateStatus.status === "failed"
      ? t("base.navRail.settingsCenter.about.updateCheckFailedDescription")
      : aboutUpdateStatus.status === "latest"
        ? t("base.navRail.settingsCenter.about.latestVersionDescription")
        : t("base.navRail.settingsCenter.about.webUpdateDescription");
  const externalLink = (label: string, href: string) => {
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      const linksBridge = getElectronLinksBridge();
      if (!linksBridge) return;

      const webOrigin = resolveWebOrigin(window.location.origin, WKApp.apiClient?.config?.apiURL);
      let absoluteUrl: string;
      try {
        absoluteUrl = new URL(href, webOrigin || undefined).href;
      } catch {
        return;
      }
      if (!/^https?:$/.test(new URL(absoluteUrl).protocol)) return;

      event.preventDefault();
      void linksBridge.openExternal(absoluteUrl).catch(() => undefined);
    };

    return <a className="wk-settings-center__external-link" href={href} target="_blank" rel="noreferrer" aria-label={label} onClick={handleClick}><ExternalLink aria-hidden="true" /></a>;
  };
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.about.title")}>
    <div className="wk-settings-center__about-identity">
      <img className="wk-settings-center__about-logo" src={octoLogo} alt={t("base.navRail.settingsCenter.about.octoLogoAlt")} />
      <div className="wk-settings-center__about-copy"><strong>{isDesktop ? "Octo Desktop" : "Octo Web"}</strong><span>{[runtimeLabel, platformLabel, `${t("base.navRail.settingsCenter.page.about.versionPrefix")}${t("base.navRail.settingsCenter.about.versionSeparator")}${WKApp.config.appVersion}`].filter(Boolean).join(" · ")}</span>{!isDesktop && <span>{updateDescription}</span>}</div>
      {!isDesktop && <div className="wk-settings-center__about-update-actions"><SettingsStatusTag tone={statusTone} label={statusLabel} /><button type="button" className="wk-settings-center__about-update" onClick={onAbout}>{updateAvailable ? t("base.navRail.settingsCenter.action.refresh") : t("base.navRail.settingsCenter.action.checkUpdate")}</button></div>}
    </div>
    <SettingsSection title={t("base.navRail.settingsCenter.section.help")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.guide")} trailing={onOpenOnboarding ? <button type="button" className="wk-settings-center__about-icon-button" onClick={onOpenOnboarding} aria-label={t("base.navRail.settingsCenter.row.guide")}><ChevronIcon /></button> : undefined} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.feedback")} trailing={externalLink(t("base.navRail.settingsCenter.row.feedback"), "https://github.com/Mininglamp-OSS/octo-web/issues/new")} />
    </SettingsSection>
    <SettingsSection title={t("base.navRail.settingsCenter.section.productInfo")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.productManual")} trailing={externalLink(t("base.navRail.settingsCenter.row.productManual"), productManualUrl)} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.changelog")} trailing={externalLink(t("base.navRail.settingsCenter.row.changelog"), "/changelog")} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.officialWebsite")} trailing={externalLink(t("base.navRail.settingsCenter.row.officialWebsite"), "https://www.mininglamp.com/")} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.openSource")} trailing={externalLink(t("base.navRail.settingsCenter.row.openSource"), "https://github.com/Mininglamp-OSS")} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.license")} trailing={externalLink(t("base.navRail.settingsCenter.row.license"), "https://github.com/Mininglamp-OSS/octo-web/blob/main/LICENSE")} />
    </SettingsSection>
    <footer className="wk-settings-center__about-footer"><img className="wk-settings-center__mininglamp-logo" src={mininglampLogo} alt={t("base.navRail.settingsCenter.about.mininglampLogoAlt")} /><p>{t("base.navRail.settingsCenter.about.developedBy")}</p><div className="wk-settings-center__about-links"><a href="https://www.mininglamp.com/about/" target="_blank" rel="noreferrer">{t("base.navRail.settingsCenter.about.learnMininglamp")}<ExternalLink aria-hidden="true" /></a><a href="https://www.mininglamp.com/" target="_blank" rel="noreferrer">{t("base.navRail.settingsCenter.about.enterpriseSupport")}<ExternalLink aria-hidden="true" /></a></div></footer>
  </SettingsPageFrame>;
}
function ChevronIcon() { return <ChevronRight className="wk-settings-center__chevron-icon" aria-hidden="true" />; }
function ShortcutRow({ label, keys }: { label: string; keys: string[] }) { return <div className="wk-settings-center__shortcut-row"><span>{label}</span><span className="wk-settings-center__shortcut-keys">{keys.map((key) => <kbd key={key}>{key}</kbd>)}</span></div>; }
function useVoiceSettings() {
  const [settings, setSettings] = React.useState<VoiceSettings>(() => voiceSettingsStore.get());
  React.useEffect(() => voiceSettingsStore.subscribe(setSettings), []);
  return settings;
}
export function getVoiceOs(environment: import("../../Runtime").RuntimeEnvironment): "windows" | "macos" { return environment.os === "macos" || (environment.os === "unknown" && /Mac|iPhone|iPad/i.test(navigator.userAgent)) ? "macos" : "windows"; }
function voiceShortcutLabel(shortcut: VoiceShortcut, os: "windows" | "macos") { return t(getVoiceShortcutLabelKey(shortcut, os)); }
function voiceModeLabel(mode: VoiceSettings["speakingMode"]) { return t(mode === "hold" ? "base.navRail.settingsCenter.value.hold" : "base.navRail.settingsCenter.value.toggle"); }
function VoiceInputSettingsPage({ environment }: { environment: import("../../Runtime").RuntimeEnvironment }) {
  const settings = useVoiceSettings();
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([]);
  const [showConsent, setShowConsent] = React.useState(false);
  const [consentChecked, setConsentChecked] = React.useState(false);
  const [consentContent, setConsentContent] = React.useState<string | null>(null);
  const [consentLoading, setConsentLoading] = React.useState(false);
  const [consentError, setConsentError] = React.useState(false);
  const [consentAccepting, setConsentAccepting] = React.useState(false);
  const [permission, setPermission] = React.useState<"granted" | "prompt" | "denied" | "unsupported">("unsupported");
  const [probeStatus, setProbeStatus] = React.useState<"idle" | "loading" | "success" | "failed">("idle");
  const [localDraft, setLocalDraft] = React.useState(() => ({ timeout: String(settings.localTimeoutMs), probe: settings.localProbeUrl, transcribe: settings.localTranscribeUrl }));
  const [localDirty, setLocalDirty] = React.useState(false);
  const permissionStatusRef = React.useRef<PermissionStatus | null>(null);
  const permissionChangeHandlerRef = React.useRef<() => void>(() => {});
  const permissionMountedRef = React.useRef(true);
  const os = getVoiceOs(environment);
  const refreshDevices = React.useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    // enumerateDevices() exposes a synthetic `default` entry in addition to
    // the physical default microphone. The UI already has its own
    // “System default microphone” option, so showing that entry duplicates it.
    const audioInputs = list.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default");
    setDevices(audioInputs);
    const selectedId = voiceSettingsStore.get().microphoneDeviceId;
    if (getMicrophonePermission() === "granted" && selectedId && !audioInputs.some((device) => device.deviceId === selectedId)) {
      voiceSettingsStore.set({ microphoneDeviceId: "" }, { internal: true });
    }
  }, []);
  const refreshPermission = React.useCallback(async () => {
    if (!permissionMountedRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) { setPermission("unsupported"); return; }
    try {
      const status = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (!permissionMountedRef.current) return;
      permissionStatusRef.current?.removeEventListener?.("change", permissionChangeHandlerRef.current);
      permissionStatusRef.current = status ?? null;
      permissionStatusRef.current?.addEventListener?.("change", permissionChangeHandlerRef.current);
      const nextPermission = status?.state === "granted" ? "granted" : status?.state === "denied" ? "denied" : "prompt";
      setPermission(nextPermission);
      setMicrophonePermission(nextPermission);
    } catch {
      if (permissionMountedRef.current) {
        setPermission("prompt");
        setMicrophonePermission("prompt");
      }
    }
  }, []);
  React.useEffect(() => {
    permissionMountedRef.current = true;
    permissionChangeHandlerRef.current = () => { void refreshPermission(); };
    void refreshPermission().then(() => refreshDevices());
    const handleDeviceChange = () => { void refreshDevices(); };
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      permissionMountedRef.current = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      permissionStatusRef.current?.removeEventListener?.("change", permissionChangeHandlerRef.current);
      permissionStatusRef.current = null;
    };
  }, [refreshDevices, refreshPermission]);
  React.useEffect(() => { setLocalDraft({ timeout: String(settings.localTimeoutMs), probe: settings.localProbeUrl, transcribe: settings.localTranscribeUrl }); setLocalDirty(false); }, [settings.localTimeoutMs, settings.localProbeUrl, settings.localTranscribeUrl]);
  React.useEffect(() => {
    if (!showConsent) return;
    let cancelled = false;
    setConsentChecked(false);
    setConsentAccepting(false);
    setConsentLoading(true);
    setConsentError(false);
    setConsentContent(null);
    getDocument("asr_service_doc")
      .then((doc) => { if (!cancelled) setConsentContent(doc.content); })
      .catch(() => { if (!cancelled) setConsentError(true); })
      .finally(() => { if (!cancelled) setConsentLoading(false); });
    return () => { cancelled = true; };
  }, [showConsent]);
  const acceptConsent = async () => {
    const spaceId = WKApp.shared.currentSpaceId;
    if (!spaceId) {
      Toast.error(t("base.navRail.settingsCenter.value.saveFailed"));
      return;
    }
    setConsentAccepting(true);
    try {
      await acceptVoiceInput(spaceId, consentChecked, () => WKApp.shared.currentSpaceId === spaceId);
      voiceSettingsStore.acknowledge();
      voiceSettingsStore.set({ enabled: true });
      Dap.shared.track("settings_voice_toggled", { enabled: true });
      setShowConsent(false);
    } catch {
      Toast.error(t("base.navRail.settingsCenter.value.saveFailed"));
    } finally {
      setConsentAccepting(false);
    }
  };
  const toggle = (enabled: boolean) => {
    if (!enabled) {
      voiceSettingsStore.set({ enabled: false });
      Dap.shared.track("settings_voice_toggled", { enabled: false });
      return;
    }
    if (settings.consent?.protocolVersion !== VOICE_PROTOCOL_VERSION) setShowConsent(true);
    else {
      voiceSettingsStore.set({ enabled: true });
      Dap.shared.track("settings_voice_toggled", { enabled: true });
    }
  };
  const authorize = async () => { if (!navigator.mediaDevices?.getUserMedia) return; try { const stream = await navigator.mediaDevices.getUserMedia({ audio: settings.microphoneDeviceId ? { deviceId: { exact: settings.microphoneDeviceId } } : true }); stream.getTracks().forEach((track) => track.stop()); await refreshDevices(); await refreshPermission(); } catch { await refreshPermission(); } };
  const permissionLabel = permission === "granted" ? t("base.navRail.settingsCenter.value.granted") : permission === "denied" ? t("base.navRail.settingsCenter.value.denied") : permission === "prompt" ? t("base.navRail.settingsCenter.value.unauthorized") : t("base.navRail.settingsCenter.value.unsupported");
  const permissionTone = permission === "granted" ? "success" : permission === "denied" ? "danger" : permission === "prompt" ? "attention" : "neutral";
  const permissionDescription = permission === "granted"
    ? t(environment.target === "web" ? "base.navRail.settingsCenter.row.microphoneGrantedWeb" : "base.navRail.settingsCenter.row.microphoneGrantedDesktop")
    : permission === "denied"
      ? t(environment.target === "web" ? "base.navRail.settingsCenter.row.microphoneDeniedWeb" : os === "windows" ? "base.navRail.settingsCenter.row.microphoneDeniedWindows" : "base.navRail.settingsCenter.row.microphoneDeniedMacos")
      : permission === "unsupported"
        ? t(environment.target === "web" ? "base.navRail.settingsCenter.row.microphoneUnsupportedWeb" : "base.navRail.settingsCenter.row.microphoneUnsupportedDesktop")
        : t(environment.target === "web" ? "base.navRail.settingsCenter.row.microphonePromptWeb" : "base.navRail.settingsCenter.row.microphonePromptDesktop");
  const saveLocalSettings = () => {
    const timeout = Number(localDraft.timeout);
    const saved = voiceSettingsStore.set({
      localTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : VOICE_SETTINGS_DEFAULTS.localTimeoutMs,
      localProbeUrl: localDraft.probe.trim(),
      localTranscribeUrl: localDraft.transcribe.trim(),
    });
    setLocalDraft({ timeout: String(saved.localTimeoutMs), probe: saved.localProbeUrl, transcribe: saved.localTranscribeUrl });
    setLocalDirty(false);
  };
  const showPermissionGuide = async () => {
    if (environment.target === "desktop" && permission === "denied") {
      const opened = await openElectronSystemSettings("microphone").catch(() => false);
      if (opened) return;
    }
    const key = environment.target === "web"
      ? "base.navRail.settingsCenter.row.microphoneGuideWeb"
      : os === "windows"
        ? "base.navRail.settingsCenter.row.microphoneGuideWindows"
        : "base.navRail.settingsCenter.row.microphoneGuideMacos";
    Toast.info(t(key));
  };
  if (showConsent) return <div className="wk-settings-center__voice-consent-page">
    <button type="button" className="wk-settings-center__voice-consent-back" onClick={() => setShowConsent(false)}>← {t("base.navRail.settingsCenter.voiceConsent.back")}</button>
    <header className="wk-settings-center__page-header"><h2>{t("base.navRail.settingsCenter.voiceConsent.pageTitle")}</h2></header>
    <div className="wk-settings-center__voice-consent-card">
      {consentLoading && <div className="wk-settings-center__voice-consent-loading"><Spin /></div>}
      {consentError && !consentLoading && <div className="wk-settings-center__voice-consent-error">{t("base.navRail.voiceNotice.loadFailed")}</div>}
      {consentContent && <div className="wk-settings-center__voice-consent-document" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(consentContent) }} />}
    </div>
    <div className="wk-settings-center__voice-consent-footer">
      <Checkbox checked={consentChecked} onCheckedChange={setConsentChecked}>{t("base.navRail.voiceNotice.feedbackConsent")}</Checkbox>
      <div className="wk-settings-center__voice-consent-actions"><button type="button" className="wk-settings-center__manage-button" onClick={() => setShowConsent(false)}>{t("base.common.cancel")}</button><button type="button" className="wk-settings-center__manage-button wk-settings-center__manage-button--primary" disabled={consentLoading || consentError || consentAccepting || !consentContent} onClick={() => { void acceptConsent(); }}>{t("base.navRail.voiceNotice.accept")}</button></div>
    </div>
  </div>;
  const shortcut = getVoiceShortcut(settings, os);
  const shortcutName = voiceShortcutLabel(shortcut, os);
  const voiceDescription = !settings.enabled ? t("base.navRail.settingsCenter.row.voiceInputEnabledDescription") : shortcut === "disabled" ? t("base.navRail.settingsCenter.voiceDescription.button") : settings.speakingMode === "toggle" ? t("base.navRail.settingsCenter.voiceDescription.toggle", { values: { shortcut: shortcutName } }) : t("base.navRail.settingsCenter.voiceDescription.hold", { values: { shortcut: shortcutName } });
  return <SettingsPageFrame title={t("base.navRail.settingsCenter.page.voice.title")}>
    <SettingsSection title={t("base.navRail.settingsCenter.section.audioDevice")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.microphoneInput")} description={t("base.navRail.settingsCenter.row.microphoneInputDescription")} trailing={<select aria-label={t("base.navRail.settingsCenter.row.microphoneInput")} className="wk-settings-center__demo-select" value={settings.microphoneDeviceId} onChange={(event) => voiceSettingsStore.set({ microphoneDeviceId: event.target.value })}><option value="">{t("base.navRail.settingsCenter.value.systemDefaultMicrophone")}</option>{devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || t("base.navRail.settingsCenter.value.microphone")}</option>)}</select>} />
      <SettingsRow title={t("base.navRail.settingsCenter.row.microphonePermission")} description={permissionDescription} trailing={<span className="wk-settings-center__row-actions"><SettingsStatusTag tone={permissionTone} label={permissionLabel} />{(permission === "prompt" || permission === "denied") && <button type="button" className="wk-settings-center__manage-button" onClick={() => { if (permission === "denied") showPermissionGuide(); else void authorize(); }}>{permission === "denied" ? t(environment.target === "web" ? "base.navRail.settingsCenter.action.viewHowToEnable" : "base.navRail.settingsCenter.action.openSystemSettings") : t("base.navRail.settingsCenter.action.authorize")}</button>}</span>} />
    </SettingsSection>
    <SettingsSection title={t("base.navRail.settingsCenter.section.voiceSettings")}>
      <SettingsRow title={t("base.navRail.settingsCenter.row.voiceInputEnabled")} description={voiceDescription} trailing={<Switch checked={settings.enabled} onChange={toggle} />} />
      {settings.enabled && <><SettingsRow title={t("base.navRail.settingsCenter.row.voiceShortcut")} trailing={<select aria-label={t("base.navRail.settingsCenter.row.voiceShortcut")} className="wk-settings-center__demo-select" value={shortcut} onChange={(event) => voiceSettingsStore.set(os === "macos" ? { shortcutMacos: event.target.value as VoiceShortcut } : { shortcutWindows: event.target.value as VoiceShortcut })}><option value="alt-right">{voiceShortcutLabel("alt-right", os)}</option><option value="shift-right">{t("base.navRail.settingsCenter.value.rightShift")}</option><option value="shift-left">{t("base.navRail.settingsCenter.value.leftShift")}</option><option value="disabled">{t("base.navRail.settingsCenter.value.disabled")}</option></select>} /><SettingsRow title={t("base.navRail.settingsCenter.row.speakingMode")} trailing={<select aria-label={t("base.navRail.settingsCenter.row.speakingMode")} disabled={shortcut === "disabled"} className="wk-settings-center__demo-select" value={settings.speakingMode} onChange={(event) => voiceSettingsStore.set({ speakingMode: event.target.value as VoiceSettings["speakingMode"] })}><option value="toggle">{t("base.navRail.settingsCenter.value.toggle")}</option><option value="hold">{t("base.navRail.settingsCenter.value.hold")}</option></select>} /><LocalVoiceSettings settings={settings} draft={localDraft} dirty={localDirty} setDraft={(next) => { setLocalDraft(next); setLocalDirty(true); }} probeStatus={probeStatus} setProbeStatus={setProbeStatus} onSave={saveLocalSettings} onReset={() => { setLocalDraft({ timeout: String(VOICE_SETTINGS_DEFAULTS.localTimeoutMs), probe: VOICE_SETTINGS_DEFAULTS.localProbeUrl, transcribe: VOICE_SETTINGS_DEFAULTS.localTranscribeUrl }); setLocalDirty(true); setProbeStatus("idle"); }} /></>}
    </SettingsSection>
  </SettingsPageFrame>;
}
function LocalVoiceSettings({ settings, draft, dirty, setDraft, probeStatus, setProbeStatus, onSave, onReset }: { settings: VoiceSettings; draft: { timeout: string; probe: string; transcribe: string }; dirty: boolean; setDraft: (draft: { timeout: string; probe: string; transcribe: string }) => void; probeStatus: "idle" | "loading" | "success" | "failed"; setProbeStatus: (status: "idle" | "loading" | "success" | "failed") => void; onSave: () => void; onReset: () => void }) {
  const update = (patch: Partial<typeof draft>) => { setDraft({ ...draft, ...patch }); setProbeStatus("idle"); };
  const test = async () => {
    setProbeStatus("loading");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    try { const response = await fetch(draft.probe, { signal: controller.signal, redirect: "manual" }); setProbeStatus(response.ok ? "success" : "failed"); }
    catch { setProbeStatus("failed"); }
    finally { window.clearTimeout(timer); }
  };
  const statusLabel = probeStatus === "loading" ? t("base.navRail.settingsCenter.value.testing") : probeStatus === "success" ? t("base.navRail.settingsCenter.value.connectionSuccess") : probeStatus === "failed" ? t("base.navRail.settingsCenter.value.connectionFailed") : t("base.navRail.settingsCenter.value.notTested");
  return <>
    <SettingsRow title={t("base.navRail.settingsCenter.row.localVoice")} description={t("base.navRail.settingsCenter.row.localVoiceDescription")} trailing={<Switch checked={settings.localEnabled} onChange={(checked) => voiceSettingsStore.set({ localEnabled: checked })} />} />
    {settings.localEnabled && <div className="wk-settings-center__local-config">
      <label className="wk-settings-center__local-field"><span>{t("base.navRail.settingsCenter.row.localTimeout")}</span><input type="number" inputMode="numeric" value={draft.timeout} onChange={(event) => update({ timeout: event.target.value })} /></label>
      <label className="wk-settings-center__local-field"><span>{t("base.navRail.settingsCenter.row.localProbeUrl")}</span><input value={draft.probe} onChange={(event) => update({ probe: event.target.value })} /><span className="wk-settings-center__local-probe-actions"><button type="button" className="wk-settings-center__manage-button" disabled={probeStatus === "loading" || !draft.probe.trim()} onClick={() => { void test(); }}>{t("base.navRail.settingsCenter.action.testConnection")}</button><span className={`wk-settings-center__local-status wk-settings-center__local-status--${probeStatus}`}>{statusLabel}</span></span></label>
      <label className="wk-settings-center__local-field"><span>{t("base.navRail.settingsCenter.row.localTranscribeUrl")}</span><input value={draft.transcribe} onChange={(event) => update({ transcribe: event.target.value })} /></label>
      <div className="wk-settings-center__local-actions"><button type="button" className="wk-settings-center__manage-button" onClick={onReset}>{t("base.navRail.settingsCenter.action.restoreDefaults")}</button><button type="button" className="wk-settings-center__manage-button wk-settings-center__manage-button--primary" disabled={!dirty} onClick={onSave}>{t("base.common.save")}</button></div>
    </div>}
  </>;
}
function ResourceSection({ title, category, children }: { title: string; category: ResourceGroup["category"]; children: React.ReactNode }) { return <section className={`wk-settings-center__resource-section wk-settings-center__resource-section--${category}`}><h3>{title}</h3><div className="wk-settings-center__resource-grid">{children}</div></section>; }
function ResourceBrandIcon({ id }: { id: string }) {
  if (id === "windows") return <svg viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="currentColor" /><rect x="1" y="11" width="9" height="9" fill="currentColor" /><rect x="11" y="1" width="9" height="9" fill="currentColor" /><rect x="11" y="11" width="9" height="9" fill="currentColor" /></svg>;
  if (id === "android") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6026 1.1087-.8106 1.584-.4941z"/></svg>;
  if (id === "iphone" || id === "macos") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z"/></svg>;
  if (id === "chrome") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364zM12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728Z"/></svg>;
  if (id === "openclaw") return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.046 7.104a.527.527 0 110 1.055.527.527 0 010-1.055zM15.376 7.104a.528.528 0 110 1.056.528.528 0 010-1.056z"/><path fill="currentColor" fillRule="evenodd" d="M16.877 1.912c.58-.27 1.14-.323 1.616-.037a.317.317 0 01-.326.542c-.227-.136-.547-.153-1.022.068-.352.165-.765.45-1.234.866 2.683 1.17 4.4 3.5 5.148 5.921a6.421 6.421 0 00-.704.184c-.578.016-1.174.204-1.502.735-.338.55-.268 1.276.072 2.069l.005.012.007.014c.523 1.045 1.318 1.91 2.2 2.284-.912 3.274-3.44 6.144-5.972 6.988v2.109h-2.11v-2.11c-1.043.417-2.086.01-2.11 0v2.11h-2.11v-2.11c-2.531-.843-5.061-3.713-5.973-6.987.882-.373 1.678-1.238 2.2-2.284l.007-.014.006-.012c.34-.793.41-1.518.071-2.069-.327-.531-.923-.719-1.503-.735a6.409 6.409 0 00-.704-.183c.749-2.421 2.466-4.751 5.149-5.922-.47-.416-.88-.701-1.234-.866-.474-.221-.794-.204-1.021-.068a.318.318 0 01-.435-.109.317.317 0 01.109-.433c.476-.286 1.036-.233 1.615.037.49.229 1.031.628 1.621 1.182A9.924 9.924 0 0112 2.568c1.199 0 2.284.19 3.256.526.59-.554 1.13-.953 1.62-1.182zM8.835 6.577a1.266 1.266 0 100 2.532 1.266 1.266 0 000-2.532zm6.33 0a1.267 1.267 0 100 2.533 1.267 1.267 0 000-2.533z"/><path fill="currentColor" d="M.395 13.118c-.966-1.932-.163-3.863 2.41-3.365v-.001l.05.01c.084.018.17.038.26.06.033.009.067.017.1.027.084.022.168.048.255.076l.09.027c.528 0 .95.158 1.16.501.212.343.212.87-.105 1.61-.085.17-.178.333-.276.489l-.01.017a4.967 4.967 0 01-.62.791l-.019.02c-1.092 1.117-2.496 1.336-3.295-.262zM21.193 9.753c2.574-.5 3.378 1.433 2.411 3.365-.58 1.159-1.476 1.361-2.342.96l-.011-.005a2.419 2.419 0 01-.114-.056l-.019-.01a2.751 2.751 0 01-.115-.067l-.023-.014c-.035-.022-.071-.044-.106-.068l-.05-.035c-.55-.388-1.062-1.007-1.44-1.76-.276-.647-.311-1.132-.174-1.472.176-.439.636-.639 1.23-.639.032-.011.066-.02.099-.03.08-.026.16-.05.238-.072l.117-.03a5.502 5.502 0 01.3-.067z"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M9 3.5c2.3 2.3 3.7 5.2 3.7 8.5s-1.4 6.2-3.7 8.5M15 3.5c-2.3 2.3-3.7 5.2-3.7 8.5s1.4 6.2 3.7 8.5M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
}
function ResourceCard({ id, title, description, status, category, action }: ResourceDefinition & { title: string; description: string; category: ResourceGroup["category"]; action?: React.ReactNode }) {
  const qrState = useMobileDownloadUrl(mobileUpdaterPaths[id], fetchMobileUpdater, WKApp.apiClient.config.apiURL);
  const isMobile = category === "clients" && (id === "android" || id === "iphone");
  if (category === "clients") {
    return <article className="wk-settings-center__resource-card wk-settings-center__resource-card--clients" data-resource-status={status}>
      <div className="wk-settings-center__client-head"><span className="wk-settings-center__resource-icon" aria-hidden="true"><ResourceBrandIcon id={id} /></span><h4>{title}</h4></div>
      {isMobile ? <div className="wk-settings-center__resource-qr" aria-label={`${title} QR code`} aria-busy={qrState.status === "loading"}>{qrState.status === "ready" ? <QRCodeSVG value={qrState.downloadUrl} size={104} /> : qrState.status === "loading" ? <Spin /> : <div className="wk-settings-center__resource-qr-error" role="alert"><span>{t("base.navRail.settingsCenter.value.qrLoadFailed")}</span><button type="button" className="wk-settings-center__manage-button" onClick={qrState.retry}>{t("base.navRail.settingsCenter.action.retry")}</button></div>}</div> : <div className="wk-settings-center__client-status"><span>{description}</span>{status === "coming-soon" && <SettingsStatusTag tone="neutral" label={t("base.navRail.settingsCenter.value.comingSoon")} />}</div>}
      {action && <div className="wk-settings-center__resource-actions">{action}</div>}
    </article>;
  }
  return <article className="wk-settings-center__resource-card wk-settings-center__resource-card--resources" data-resource-status={status}>
    <div className="wk-settings-center__resource-identity"><span className="wk-settings-center__resource-icon" aria-hidden="true"><ResourceBrandIcon id={id} /></span><div className="wk-settings-center__resource-body"><h4>{title}</h4><p>{description}</p>{id === "openclaw" && <span className="wk-settings-center__resource-meta">{t("base.navRail.settingsCenter.resource.sourcePrefix")}ClawHub · GitHub</span>}</div></div>
    {action && <div className="wk-settings-center__resource-actions">{action}</div>}
  </article>;
}
