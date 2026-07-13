import WKApp from "../../App";
import { checkVersionOnce } from "../../Utils/versionChecker";
import classnames from "classnames";
import React, { Component } from "react";
import { Toast, Spin, Button, Progress } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import NavVoiceSettingsItem from "./NavVoiceSettingsItem";
import NavSecretsSettingsItem from "./NavSecretsSettingsItem";
import { i18n, t } from "../../i18n";
import { apiFetchJson } from "../../Service/apiFetch";

export interface NavSettingsPanelProps {
    settingSelected: boolean;
    hasNewVersion: boolean;
    showNewVersion: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    showAppUpdateOperation: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string };
    /** 是否显示「空间管理」入口（仅 owner/admin 可见） */
    canManageSpace?: boolean;
    onOpenOnboarding?: () => void;
    onToggleSetting: () => void;
    onSetShowNewVersion: (v: boolean) => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onNotifyListener: () => void;
}

interface NavSettingsPanelState {
    changelog: { notes: string; version: string; pub_date: string } | null;
    changelogLoading: boolean;
    hasNewVersionLocal: boolean;
}

export default class NavSettingsPanel extends Component<NavSettingsPanelProps, NavSettingsPanelState> {
    private _fetchingChangelog = false; // 实例属性防并发，避免 setState 异步批处理导致的竞态

    state: NavSettingsPanelState = {
        changelog: null,
        changelogLoading: false,
        hasNewVersionLocal: false,
    };

    componentDidUpdate(prevProps: NavSettingsPanelProps) {
        // 面板刚打开时检查一次版本
        if (this.props.settingSelected && !prevProps.settingSelected) {
            this.checkVersion();
        }
    }

    checkVersion = async () => {
        const serverVersion = await checkVersionOnce();
        this.setState({ hasNewVersionLocal: serverVersion !== null });
    };

    fetchChangelog = async () => {
        if (this._fetchingChangelog) return;
        this._fetchingChangelog = true;
        this.setState({ changelogLoading: true });
        try {
            const apiURL = WKApp.apiClient.config.apiURL;
            const data = await apiFetchJson<{ notes?: unknown; version?: string; pub_date?: string }>(`${apiURL}common/updater/web/1.0`);
            if (!data || typeof data.notes !== 'string') {
                throw new Error('Invalid changelog format');
            }
            this.setState({
                changelog: {
                    notes: data.notes,
                    version: data.version || "",
                    pub_date: data.pub_date || "",
                },
                changelogLoading: false,
            });
        } catch (e) {
            console.error('[NavSettingsPanel] fetch changelog failed', e);
            this.setState({ changelogLoading: false });
            Toast.error(t("base.navRail.settingsPanel.changelogLoadFailed"));
        } finally {
            this._fetchingChangelog = false;
        }
    };

    render() {
        const {
            settingSelected,
            hasNewVersion,
            showNewVersion,
            showAppVersion,
            showAppUpdate,
            appUpdateProgress,
            showAppUpdateOperation,
            lastVersionInfo,
            canManageSpace = false,
            onOpenOnboarding,
            onToggleSetting,
            onSetShowNewVersion,
            onSetShowAppVersion,
            onInstallUpdate,
            onNotifyListener,
        } = this.props;

        const { hasNewVersionLocal } = this.state;

        // 仅 OIDC 登录用户 + 后端在该 provider 下发了 accountUrl 时显示「账户中心」入口。
        // 普通账号无此入口（应用内修改密码暂未实现）。
        // 按 loginProvider id 在 oidcProviders 数组里查对应 provider 的 accountUrl,
        // 多 provider 部署时不同用户跳到各自的账户中心。
        const providerId = WKApp.loginInfo.loginProvider;
        const oidcProvider = providerId
            ? WKApp.remoteConfig.oidcProviders.find((p) => p.id === providerId)
            : undefined;
        const accountCenterUrl = oidcProvider?.accountUrl;
        const showAccountCenter = !!providerId && providerId !== 'local' && !!accountCenterUrl;

        return (
            <>
                {/* 点击外部关闭 mask */}
                {settingSelected && (
                    <div
                        style={{ position: "fixed", inset: 0, zIndex: 199 }}
                        onClick={onToggleSetting}
                    />
                )}
                <ul className={classnames("wk-sider-setting-list wk-navrail__settings-list", settingSelected ? "open" : undefined)}>
                    {/* 版本更新提示（面板打开时自检，有新版本时展示） */}
                    {hasNewVersionLocal && (
                        <li className="wk-navrail__settings-version-update" onClick={(e) => e.stopPropagation()}>
                            <span>{t("base.navRail.settingsPanel.versionAvailable")}</span>
                            <button
                                className="wk-navrail__settings-version-refresh"
                                onClick={() => {
                                    const key = 'wk_version_reload_count';
                                    const count = Number(sessionStorage.getItem(key) || 0);
                                    if (count < 3) {
                                        sessionStorage.setItem(key, String(count + 1));
                                        window.location.reload();
                                    } else {
                                        alert(t("base.navRail.versionBubble.reloadLimit"));
                                    }
                                }}
                            >
                                {t("base.navRail.settingsPanel.refreshNow")}
                            </button>
                        </li>
                    )}
                    {/* 暗黑模式入口已关闭 */}
                    {showAccountCenter && (
                        <li onClick={() => {
                            onToggleSetting();
                            window.open(accountCenterUrl, '_blank', 'noopener,noreferrer');
                        }}>
                            {t("base.navRail.settingsPanel.accountCenter")}
                        </li>
                    )}
                    <li onClick={() => {
                        onToggleSetting();
                        this.fetchChangelog();
                        onSetShowNewVersion(true);
                    }}>
                        {t("base.navRail.settingsPanel.changelog")}
                    </li>
                    {onOpenOnboarding && (
                        <li onClick={() => {
                            onToggleSetting();
                            onOpenOnboarding();
                        }}>
                            {t("base.navRail.settingsPanel.onboarding")}
                        </li>
                    )}
                    {canManageSpace && (
                        <li onClick={() => {
                            onToggleSetting();
                            // /space 是独立打包的 admin SPA（同源），React Router 不识别，必须整页跳转；
                            // 真实鉴权由 admin 后端负责，此处仅用于 UI 可见性控制。
                            window.location.href = "/space";
                        }}>
                            {t("base.navRail.settingsPanel.spaceManagement")}
                        </li>
                    )}
                    <li onClick={() => {
                        onToggleSetting();
                        WKApp.shared.notificationIsClose = !WKApp.shared.notificationIsClose;
                    }}>
                        {WKApp.shared.notificationIsClose
                            ? t("base.navRail.settingsPanel.desktopNotification.on")
                            : t("base.navRail.settingsPanel.desktopNotification.off")}
                    </li>
                    <NavVoiceSettingsItem />
                    <NavSecretsSettingsItem />
                    <li onClick={() => {
                        onToggleSetting();
                        void WKApp.shared.logoutUserInitiated();
                    }}>
                        {t("base.navRail.settingsPanel.logout")}
                    </li>
                </ul>

                {/* 更新日志 Modal */}
                <WKModal
                    title={t("base.navRail.settingsPanel.changelog")}
                    visible={showNewVersion}
                    onCancel={() => onSetShowNewVersion(false)}
                >
                    {this.state.changelogLoading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: '32px' }}>
                            <Spin size="large" />
                        </div>
                    ) : this.state.changelog ? (
                        <div style={{ overflow: 'auto', maxHeight: 400, padding: '8px 0' }}>
                            <div style={{ fontSize: 13, color: 'rgba(28,28,35,0.4)', marginBottom: 12 }}>
                                {t("base.common.version")} {this.state.changelog.version || t("base.common.unknown")} · {this.state.changelog.pub_date ? i18n.format.date(this.state.changelog.pub_date) : ''}
                            </div>
                            <pre style={{
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                fontSize: 14,
                                lineHeight: 1.7,
                                margin: 0,
                                fontFamily: "'PingFang SC', sans-serif",
                                color: 'rgba(28,28,35,0.9)',
                            }}>
                                {this.state.changelog.notes}
                            </pre>
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '32px', color: 'rgba(28,28,35,0.4)' }}>
                            {t("base.navRail.settingsPanel.noChangelog")}
                        </div>
                    )}
                </WKModal>

                {/* 更新进度 Modal */}
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
                    {lastVersionInfo && (
                        <div className="wk-versioncheckview">
                            <div className="wk-versioncheckview-content">
                                <div className="wk-versioncheckview-updateinfo">
                                    <ul>
                                        <li>{t("base.navRail.settingsPanel.currentVersion")}: {WKApp.config.appVersion}&nbsp;&nbsp;{t("base.navRail.settingsPanel.targetVersion")}: {lastVersionInfo.appVersion}</li>
                                        <li>{t("base.navRail.settingsPanel.updateContent")}</li>
                                        <li><pre>{lastVersionInfo.updateDesc}</pre></li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    )}
                    {showAppUpdate && (
                        <Progress percent={appUpdateProgress} style={{ height: "8px" }} showInfo aria-label="update progress" />
                    )}
                    </div>
                </WKModal>

            </>
        );
    }
}
