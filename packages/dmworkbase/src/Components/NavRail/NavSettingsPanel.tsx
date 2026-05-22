import WKApp from "../../App";
import { checkVersionOnce } from "../../Utils/versionChecker";
import classnames from "classnames";
import React, { Component } from "react";
import { Toast, Spin, Button, Progress } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import NavVoiceFeedbackItem from "./NavVoiceFeedbackItem";

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
            const resp = await fetch(`${apiURL}common/updater/web/1.0`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (!data || typeof data.notes !== 'string') {
                throw new Error('Invalid changelog format');
            }
            this.setState({ changelog: data, changelogLoading: false });
        } catch (e) {
            console.error('[NavSettingsPanel] fetch changelog failed', e);
            this.setState({ changelogLoading: false });
            Toast.error("获取更新日志失败");
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
                            <span>发现新版本</span>
                            <button
                                className="wk-navrail__settings-version-refresh"
                                onClick={() => {
                                    const key = 'wk_version_reload_count';
                                    const count = Number(sessionStorage.getItem(key) || 0);
                                    if (count < 3) {
                                        sessionStorage.setItem(key, String(count + 1));
                                        window.location.reload();
                                    } else {
                                        alert('页面已多次刷新仍检测到新版本，请按 Ctrl+Shift+R（Mac: Cmd+Shift+R）强制刷新并清除缓存。');
                                    }
                                }}
                            >
                                立即刷新
                            </button>
                        </li>
                    )}
                    {/* 暗黑模式入口已关闭 */}
                    {showAccountCenter && (
                        <li onClick={() => {
                            onToggleSetting();
                            window.open(accountCenterUrl, '_blank', 'noopener,noreferrer');
                        }}>
                            账户中心
                        </li>
                    )}
                    <li onClick={() => {
                        onToggleSetting();
                        this.fetchChangelog();
                        onSetShowNewVersion(true);
                    }}>
                        更新日志
                    </li>
                    {canManageSpace && (
                        <li onClick={() => {
                            onToggleSetting();
                            // /space 是独立打包的 admin SPA（同源），React Router 不识别，必须整页跳转；
                            // 真实鉴权由 admin 后端负责，此处仅用于 UI 可见性控制。
                            window.location.href = "/space";
                        }}>
                            空间管理
                        </li>
                    )}
                    <li onClick={() => {
                        onToggleSetting();
                        WKApp.shared.notificationIsClose = !WKApp.shared.notificationIsClose;
                    }}>
                        {WKApp.shared.notificationIsClose ? "打开" : "关闭"}桌面通知
                    </li>
                    <NavVoiceFeedbackItem />
                    <li onClick={() => {
                        onToggleSetting();
                        WKApp.shared.logout();
                    }}>
                        退出登录
                    </li>
                </ul>

                {/* 更新日志 Modal */}
                <WKModal
                    title="更新日志"
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
                                版本 {this.state.changelog.version || '未知'} · {this.state.changelog.pub_date ? new Date(this.state.changelog.pub_date).toLocaleDateString('zh-CN') : ''}
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
                            暂无更新日志
                        </div>
                    )}
                </WKModal>

                {/* 更新进度 Modal */}
                <WKModal
                    title="检测更新"
                    visible={showAppVersion}
                    options={{ maskClosable: false, closeOnEsc: false }}
                    onCancel={() => { onSetShowAppVersion(false); onNotifyListener(); }}
                    footer={showAppUpdateOperation ? (
                        <>
                            <Button theme="solid" type="tertiary" onClick={() => { onSetShowAppVersion(false); onNotifyListener(); }}>取消</Button>
                            <Button theme="solid" type="primary" onClick={onInstallUpdate}>更新</Button>
                        </>
                    ) : undefined}
                >
                    <div style={{ overflow: "auto", height: 200 }}>
                    {lastVersionInfo && (
                        <div className="wk-versioncheckview">
                            <div className="wk-versioncheckview-content">
                                <div className="wk-versioncheckview-updateinfo">
                                    <ul>
                                        <li>当前版本: {WKApp.config.appVersion}&nbsp;&nbsp;目标版本: {lastVersionInfo.appVersion}</li>
                                        <li>更新内容：</li>
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


