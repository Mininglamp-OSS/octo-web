import WKApp, { ThemeMode } from "../../App";
import classnames from "classnames";
import React, { Component } from "react";
import { Badge, Toast, Progress, Button } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";

export interface NavSettingsPanelProps {
    settingSelected: boolean;
    hasNewVersion: boolean;
    showNewVersion: boolean;
    showAppVersion: boolean;
    showAppUpdate: boolean;
    appUpdateProgress: number;
    showAppUpdateOperation: boolean;
    lastVersionInfo?: { appVersion: string; updateDesc: string };
    onToggleSetting: () => void;
    onSetShowNewVersion: (v: boolean) => void;
    onSetShowAppVersion: (v: boolean) => void;
    onInstallUpdate: () => void;
    onNotifyListener: () => void;
}

export default class NavSettingsPanel extends Component<NavSettingsPanelProps> {
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
            onToggleSetting,
            onSetShowNewVersion,
            onSetShowAppVersion,
            onInstallUpdate,
            onNotifyListener,
        } = this.props;

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
                    <li onClick={() => {
                        onToggleSetting();
                        if (WKApp.config.themeMode === ThemeMode.dark) {
                            WKApp.config.themeMode = ThemeMode.light;
                        } else {
                            WKApp.config.themeMode = ThemeMode.dark;
                        }
                    }}>
                        {`${WKApp.config.themeMode === ThemeMode.dark ? "关闭" : "打开"}黑暗模式`}
                    </li>
                    <li onClick={() => {
                        onToggleSetting();
                        if ((window as any).__POWERED_ELECTRON__) {
                            (window as any).ipc.send("check-update");
                        } else {
                            if (hasNewVersion) {
                                onSetShowNewVersion(true);
                            } else {
                                Toast.success("已经是最新版本");
                            }
                        }
                    }}>
                        检查版本&nbsp;v{WKApp.config.appVersion}&nbsp;
                        {hasNewVersion ? <Badge dot type="danger" /> : undefined}
                    </li>
                    <li onClick={() => {
                        onToggleSetting();
                        WKApp.shared.notificationIsClose = !WKApp.shared.notificationIsClose;
                    }}>
                        {WKApp.shared.notificationIsClose ? "打开" : "关闭"}桌面通知
                    </li>
                    <li onClick={() => {
                        onToggleSetting();
                        WKApp.shared.logout();
                    }}>
                        退出登录
                    </li>
                </ul>

                {/* 版本信息 Modal */}
                <WKModal
                    title="检测到新版本信息"
                    visible={showNewVersion}
                    onCancel={() => onSetShowNewVersion(false)}
                >
                    {lastVersionInfo && <VersionCheckView lastVersion={lastVersionInfo} />}
                </WKModal>

                {/* 更新进度 Modal */}
                <WKModal
                    title="检测更新"
                    visible={showAppVersion}
                    options={{ maskClosable: false }}
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

interface VersionCheckViewProps {
    lastVersion: { appVersion: string; updateDesc: string };
}
class VersionCheckView extends Component<VersionCheckViewProps> {
    render() {
        const { lastVersion } = this.props;
        return (
            <div className="wk-versioncheckview">
                <div className="wk-versioncheckview-content">
                    <div className="wk-versioncheckview-updateinfo">
                        <ul>
                            <li>当前版本: {WKApp.config.appVersion}&nbsp;&nbsp;目标版本: {lastVersion.appVersion}</li>
                            <li>更新内容：</li>
                            <li><pre>{lastVersion.updateDesc}</pre></li>
                        </ul>
                    </div>
                    <div className="wk-versioncheckview-tip">
                        <div className="wk-versioncheckview-tip-title">更新方法：</div>
                        <div className="wk-versioncheckview-tip-content">
                            <ul>
                                <li>1. Windows系统中的某些浏览器: Ctrl + F5刷新。</li>
                                <li>2. MacOS系统的Safari浏览器: Command + Option + R刷新。</li>
                                <li>3. MacOS系统中的某些浏览器: Command + Shift + R刷新。</li>
                                <li>4. 浏览器打开"设置" → "清理浏览数据" → 勾选"缓存的图片和文件" → "清理" → 刷新页面。</li>
                                <li>5. 若上述方法都不行，请直接清理浏览器的数据或缓存。</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
