import { Button, Modal as OctoModal } from "@octo/ui";
import WKApp from "../../App";
import React, { Component, useState } from "react";
import { Toast } from "@douyinfe/semi-ui";
import { t } from "../../i18n";
import { isElectronPowered, sendElectronCheckUpdate } from "../../electron/desktopBridge";
import { checkVersionOnceWithStatus } from "../../Utils/versionChecker";
import updateRocketIllustration from "../../assets/update-rocket.svg";
import ChangelogMarkdown from "./ChangelogMarkdown";
import SettingsCenter, { OpenSecretsRequest } from "./SettingsCenter";
import type { AboutUpdateStatus } from "./settingsPages";
import "./index.css";

let updateProgressGradientSeq = 0;

export interface NavSettingsPanelProps {
    settingSelected: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    appUpdateDownloadedBytes?: number;
    showAppUpdateOperation: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string; forceUpdate?: boolean };
    onOpenOnboarding?: () => void;
    onToggleSetting: () => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onCancelUpdateDownload?: () => void;
    onQuitApp?: () => void;
    onNotifyListener: () => void;
}

interface NavSettingsPanelState {
    secretsRequest: OpenSecretsRequest | null;
    aboutUpdateStatus: AboutUpdateStatus;
}

function UpdateRocketIllustration() {
    return <img className="wk-update-modal__illustration" src={updateRocketIllustration} width="160" height="160" alt="" />;
}

function formatDownloadedBytes(bytes?: number): string {
    if (!bytes || bytes < 0) return "";
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function UpdateProgressCircle({ progress, downloadedBytes }: { progress: number; downloadedBytes?: number }) {
    const [gradientId] = useState(() => `wk-update-progress-gradient-${++updateProgressGradientSeq}`);
    const radius = 64;
    const circumference = 2 * Math.PI * radius;
    const indeterminate = progress < 0;
    const boundedProgress = Math.min(100, Math.max(0, progress));
    const dashOffset = circumference * (1 - boundedProgress / 100);

    return (
        <div className={`wk-update-modal__progress-circle${indeterminate ? " wk-update-modal__progress-circle--indeterminate" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : boundedProgress}>
            <svg viewBox="0 0 180 180" aria-hidden="true">
                <defs>
                    <linearGradient id={gradientId} x1="154" y1="90" x2="52" y2="135" gradientUnits="userSpaceOnUse">
                        <stop stopColor="var(--wk-brand-tint-12)" />
                        <stop offset="1" stopColor="var(--wk-color-accent)" />
                    </linearGradient>
                </defs>
                <circle className="wk-update-modal__progress-circle-track" cx="90" cy="90" r={radius} transform="rotate(-90 90 90)" />
                <circle className="wk-update-modal__progress-circle-value" cx="90" cy="90" r={radius} stroke={`url(#${gradientId})`} strokeDasharray={circumference} strokeDashoffset={dashOffset} transform="rotate(-90 90 90)" />
            </svg>
            <div className="wk-update-modal__progress-circle-label">
                <strong>{indeterminate ? "..." : `${Math.round(boundedProgress)}%`}</strong>
                <span>{indeterminate ? formatDownloadedBytes(downloadedBytes) || t("base.navRail.settingsPanel.updatingTitle") : t("base.navRail.settingsPanel.updatingTitle")}</span>
            </div>
        </div>
    );
}

/** The settings button owns one modal. Legacy flyout actions are intentionally not mounted here. */
export default class NavSettingsPanel extends Component<NavSettingsPanelProps, NavSettingsPanelState> {
    private secretsSequence = 0;

    state: NavSettingsPanelState = { secretsRequest: null, aboutUpdateStatus: { status: "skipped" } };

    componentDidMount() {
        WKApp.mittBus.on("wk:open-secrets", this.handleOpenSecrets);
    }

    componentWillUnmount() {
        WKApp.mittBus.off("wk:open-secrets", this.handleOpenSecrets);
    }

    handleOpenSecrets = (payload?: { create?: boolean; name?: string; value?: string }) => {
        this.secretsSequence += 1;
        this.setState({ secretsRequest: { ...payload, sequence: this.secretsSequence } });
        if (!this.props.settingSelected) this.props.onToggleSetting();
    };

    closeSettings = () => {
        this.setState({ secretsRequest: null });
        if (this.props.settingSelected) this.props.onToggleSetting();
    };

    openOnboarding = () => {
        if (this.props.settingSelected) this.props.onToggleSetting();
        this.props.onOpenOnboarding?.();
    };

    render() {
        const {
            settingSelected,
            showAppVersion,
            showAppUpdate,
            appUpdateProgress,
            appUpdateDownloadedBytes,
            showAppUpdateOperation,
            lastVersionInfo,
            onOpenOnboarding,
            onSetShowAppVersion,
            onInstallUpdate,
            onCancelUpdateDownload,
            onQuitApp,
            onNotifyListener,
        } = this.props;
        const forceUpdate = Boolean(lastVersionInfo?.forceUpdate);
        const canCloseUpdateModal = !forceUpdate && !showAppUpdate;

        const providerId = WKApp.loginInfo.loginProvider;
        const oidcProvider = providerId ? WKApp.remoteConfig.oidcProviders.find((p) => p.id === providerId) : undefined;
        const accountCenterUrl = oidcProvider?.accountUrl;

        return (
            <>
                <SettingsCenter
                    visible={settingSelected}
                    isDesktop={Boolean((WKApp.config as unknown as { isDesktop?: boolean } | undefined)?.isDesktop)}
                    hasAccountCenter={Boolean(accountCenterUrl)}
                    accountCenterUrl={accountCenterUrl}
                    onClose={this.closeSettings}
                    onLogout={() => { this.closeSettings(); void WKApp.shared.logoutUserInitiated(); }}
                    onSecretsClosed={() => this.setState({ secretsRequest: null })}
                    onAbout={this.handleAboutAction}
                    aboutUpdateStatus={this.state.aboutUpdateStatus}
                    onOpenOnboarding={this.openOnboarding}
                    openSecretsRequest={this.state.secretsRequest}
                />

                <OctoModal
                    title={t("base.navRail.settingsPanel.updateCheckTitle")}
                    visible={showAppVersion}
                    width="480px"
                    className="wk-update-modal"
                    bodyStyle={{ padding: 0 }}
                    options={{ closable: canCloseUpdateModal, maskClosable: false, closeOnEsc: canCloseUpdateModal }}
                    onCancel={() => {
                        if (!canCloseUpdateModal) return;
                        onSetShowAppVersion(false);
                        onNotifyListener();
                    }}
                    footer={showAppUpdate ? (
                        forceUpdate ? (
                            <Button variant="secondary" onClick={onQuitApp}>
                                {t("base.navRail.settingsCenter.value.quitOcto")}
                            </Button>
                        ) : (
                        <Button variant="secondary" onClick={onCancelUpdateDownload}>
                            {t("base.common.cancel")}
                        </Button>
                        )
                    ) : showAppUpdateOperation ? (
                        <>
                            {forceUpdate ? (
                                <Button variant="secondary" onClick={onQuitApp}>
                                    {t("base.navRail.settingsCenter.value.quitOcto")}
                                </Button>
                            ) : (
                                <Button variant="secondary" onClick={() => { onSetShowAppVersion(false); onNotifyListener(); }}>{t("base.common.cancel")}</Button>
                            )}
                            <Button variant="solid" onClick={onInstallUpdate}>
                                {t("base.common.update")}
                            </Button>
                        </>
                    ) : undefined}
                >
                    <div className="wk-update-modal__body">
                        {showAppUpdate ? <>
                            <UpdateProgressCircle progress={appUpdateProgress} downloadedBytes={appUpdateDownloadedBytes} />
                            {lastVersionInfo && <div className="wk-update-modal__summary">
                                <div className="wk-update-modal__versions">{t("base.navRail.settingsPanel.currentVersion")} {WKApp.config.appVersion}&nbsp;&nbsp;{t("base.navRail.settingsPanel.targetVersion")} {lastVersionInfo.appVersion}</div>
                                <div className="wk-update-modal__content">
                                    <div className="wk-update-modal__content-title">{t("base.navRail.settingsPanel.updateContent")}</div>
                                    <ChangelogMarkdown content={lastVersionInfo.updateDesc} />
                                </div>
                            </div>}
                        </> : <>
                            <UpdateRocketIllustration />
                            {lastVersionInfo && <div className="wk-update-modal__summary">
                                <div className="wk-update-modal__versions">{t("base.navRail.settingsPanel.currentVersion")} {WKApp.config.appVersion}&nbsp;&nbsp;{t("base.navRail.settingsPanel.targetVersion")} {lastVersionInfo.appVersion}</div>
                                <div className="wk-update-modal__content">
                                    <div className="wk-update-modal__content-title">{t("base.navRail.settingsPanel.updateContent")}</div>
                                    <ChangelogMarkdown content={lastVersionInfo.updateDesc} />
                                </div>
                                {forceUpdate && <div className="wk-update-modal__force-update">{t("base.navRail.settingsPanel.forceUpdateRequired")}</div>}
                            </div>}
                        </>}
                    </div>
                </OctoModal>
            </>
        );
    }

    private checkVersion = async () => {
        if (isElectronPowered()) {
            sendElectronCheckUpdate();
            return;
        }
        const result = await checkVersionOnceWithStatus();
        if (result.status !== "skipped") this.setState({ aboutUpdateStatus: result });
        if (result.status === "update") Toast.info(`${t("base.navRail.settingsPanel.versionAvailable")}: ${result.version}`);
        else if (result.status === "latest") Toast.success(t("base.navRail.settingsCenter.value.latestVersion"));
        else if (result.status === "skipped") return;
        else Toast.error(t("base.navRail.settingsCenter.value.updateCheckFailed"));
    };

    private handleAboutAction = () => {
        if (this.state.aboutUpdateStatus.status !== "update") {
            void this.checkVersion();
            return;
        }
        const key = "wk_version_reload_count";
        const count = Number(sessionStorage.getItem(key) || 0);
        if (count < 3) {
            sessionStorage.setItem(key, String(count + 1));
            window.location.reload();
        } else {
            alert(t("base.navRail.versionBubble.reloadLimit"));
        }
    };
}
