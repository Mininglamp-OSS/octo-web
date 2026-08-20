import { Button } from "@octo/ui";
import WKApp from "../../App";
import React, { Component } from "react";
import { Toast, Spin, Progress } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { t } from "../../i18n";
import { i18n } from "../../i18n";
import { apiFetchJson } from "../../Service/apiFetch";
import { checkVersionOnceWithStatus } from "../../Utils/versionChecker";
import ChangelogMarkdown from "./ChangelogMarkdown";
import SettingsCenter, { OpenSecretsRequest } from "./SettingsCenter";

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
    changelog: { notes: string; version: string; pub_date: string } | null;
    changelogLoading: boolean;
    showChangelog: boolean;
}

/** The settings button owns one modal. Legacy flyout actions are intentionally not mounted here. */
export default class NavSettingsPanel extends Component<NavSettingsPanelProps, NavSettingsPanelState> {
    private secretsSequence = 0;

    state: NavSettingsPanelState = { secretsRequest: null, changelog: null, changelogLoading: false, showChangelog: false };

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

    showChangelog = async () => {
        this.setState({ showChangelog: true, changelogLoading: true });
        try {
            const data = await apiFetchJson<{ notes?: unknown; version?: string; pub_date?: string }>(`${WKApp.apiClient.config.apiURL}common/updater/web/1.0`);
            if (!data || typeof data.notes !== "string") throw new Error("Invalid changelog format");
            this.setState({ changelog: { notes: data.notes, version: data.version || "", pub_date: data.pub_date || "" }, changelogLoading: false });
        } catch {
            this.setState({ changelogLoading: false });
            Toast.error(t("base.navRail.settingsPanel.changelogLoadFailed"));
        }
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
                    onAbout={() => { void this.checkVersion(); }}
                    onChangelog={() => { void this.showChangelog(); }}
                    onOpenOnboarding={this.openOnboarding}
                    openSecretsRequest={this.state.secretsRequest}
                />

                <WKModal title={t("base.navRail.settingsPanel.changelog")} visible={this.state.showChangelog} onCancel={() => this.setState({ showChangelog: false })}>
                    {this.state.changelogLoading ? <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spin size="large" /></div> : this.state.changelog ? <div className="wk-navrail__changelog-content"><div className="wk-navrail__changelog-meta">{t("base.common.version")} {this.state.changelog.version || t("base.common.unknown")} · {this.state.changelog.pub_date ? i18n.format.date(this.state.changelog.pub_date) : ""}</div><ChangelogMarkdown content={this.state.changelog.notes} /></div> : <div style={{ textAlign: "center", padding: 32 }}>{t("base.navRail.settingsPanel.noChangelog")}</div>}
                </WKModal>

                <WKModal
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
                </WKModal>
            </>
        );
    }

    private checkVersion = async () => {
        const result = await checkVersionOnceWithStatus();
        if (result.status === "update") Toast.info(`${t("base.navRail.settingsPanel.versionAvailable")}: ${result.version}`);
        else if (result.status === "latest") Toast.success(t("base.navRail.settingsCenter.value.latestVersion"));
        else if (result.status === "skipped") return;
        else Toast.error(t("base.navRail.settingsCenter.value.updateCheckFailed"));
    };
}
