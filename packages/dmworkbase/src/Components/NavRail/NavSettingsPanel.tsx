import { Button, Modal as OctoModal } from "@octo/ui";
import WKApp from "../../App";
import React, { Component } from "react";
import { Progress, Toast } from "@douyinfe/semi-ui";
import { t } from "../../i18n";
import { checkVersionOnceWithStatus } from "../../Utils/versionChecker";
import ChangelogMarkdown from "./ChangelogMarkdown";
import SettingsCenter, { OpenSecretsRequest } from "./SettingsCenter";
import type { AboutUpdateStatus } from "./settingsPages";

export interface NavSettingsPanelProps {
    settingSelected: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    showAppUpdateOperation: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string };
    onOpenOnboarding?: () => void;
    onToggleSetting: () => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onNotifyListener: () => void;
}

interface NavSettingsPanelState {
    secretsRequest: OpenSecretsRequest | null;
    aboutUpdateStatus: AboutUpdateStatus;
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
            showAppUpdateOperation,
            lastVersionInfo,
            onOpenOnboarding,
            onSetShowAppVersion,
            onInstallUpdate,
            onNotifyListener,
        } = this.props;

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
                    options={{ maskClosable: false, closeOnEsc: false }}
                    onCancel={() => { onSetShowAppVersion(false); onNotifyListener(); }}
                    footer={showAppUpdateOperation ? (
                        <>
                            <Button theme="solid" type="tertiary" onClick={() => { onSetShowAppVersion(false); onNotifyListener(); }}>{t("base.common.cancel")}</Button>
                            <Button theme="solid" type="primary" onClick={onInstallUpdate}>{t("base.common.update")}</Button>
                        </>
                    ) : undefined}
                >
                    <div style={{ overflow: "auto", height: 200 }}>
                        {lastVersionInfo && <div className="wk-versioncheckview"><div className="wk-versioncheckview-content"><div className="wk-versioncheckview-updateinfo"><ul>
                            <li>{t("base.navRail.settingsPanel.currentVersion")}: {WKApp.config.appVersion}&nbsp;&nbsp;{t("base.navRail.settingsPanel.targetVersion")}: {lastVersionInfo.appVersion}</li>
                            <li>{t("base.navRail.settingsPanel.updateContent")}</li>
                            <li><ChangelogMarkdown content={lastVersionInfo.updateDesc} /></li>
                        </ul></div></div></div>}
                        {showAppUpdate && <Progress percent={appUpdateProgress} style={{ height: "8px" }} showInfo aria-label="update progress" />}
                    </div>
                </OctoModal>
            </>
        );
    }

    private checkVersion = async () => {
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
