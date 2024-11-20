import { WKApp, Menus, ThemeMode, MeInfo } from "@tsdaodao/base";
import classnames from "classnames";
import React from "react";
import { Component } from "react";
import MainVM, { VersionInfo } from "./vm";
import "./tab_normal_screen.css";
import { Badge, Modal, Toast, Progress, Button } from "@douyinfe/semi-ui";

export interface TabNormalScreenProps {
  vm: MainVM;
}

export class TabNormalScreen extends Component<TabNormalScreenProps> {
  componentDidMount() {
    WKApp.menus.setRefresh = () => {
      this.setState({});
    };
  }
  render() {
    const { vm } = this.props;
    return (
      <div className="wk-main-sider">
        <ul className="wk-main-sider-content">
          <li
            className="wk-main-sider-avatar"
            onClick={() => {
              const uid = WKApp.loginInfo.uid;
              WKApp.apiClient
                .get(`/users/${uid}`)
                .then((data) => {
                  const loginInfo = WKApp.loginInfo;
                  loginInfo.shortNo = data.short_no;
                  loginInfo.name = data.name;
                  loginInfo.sex = data.sex;
                  loginInfo.save();

                  vm.showMeInfo = true;
                })
                .catch((err) => {
                  console.log(err);
                });
            }}
          >
            <img
              alt=""
              src={WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")}
            ></img>
          </li>
          {vm.menusList.map((menus: Menus) => {
            return (
              <li
                className="wk-main-sider-item"
                title={menus.title}
                key={menus.id}
                onClick={() => {
                  vm.currentMenus = menus;
                  if (menus.onPress) {
                    menus.onPress();
                  } else {
                    WKApp.routeLeft.popToRoot();
                    // WKApp.route.push(menus.routePath)
                  }
                }}
              >
                {menus.badge && menus.badge > 0 ? (
                  <div className="wk-main-sider-item-badge">
                    <Badge count={menus.badge} type="danger"></Badge>
                  </div>
                ) : undefined}
                {menus.id === vm.currentMenus?.id
                  ? menus.selectedIcon
                  : menus.icon}
              </li>
            );
          })}

          <li
            className="wk-main-sider-setting-box"
            onClick={() => {
              vm.settingSelected = !vm.settingSelected;
            }}
          >
            {vm.hasNewVersion ? (
              <div className="wk-main-sider-setting-badge">
                <Badge type="danger" dot>
                  {" "}
                </Badge>
              </div>
            ) : undefined}
            <div
              className={classnames(
                "wk-main-sider-setting",
                vm.settingSelected ? "collapsed" : undefined
              )}
            >
              <span className="wk-sider-setting-position-re wk-icon-bar"></span>
              <span className="wk-icon-bar"></span>
              <span className="wk-sider-setting-position-re wk-icon-bar"></span>
            </div>
          </li>
        </ul>
        <ul
          className={classnames(
            "wk-sider-setting-list",
            vm.settingSelected ? "open" : undefined
          )}
        >
          <li
            onClick={() => {
              vm.settingSelected = false;
              if (WKApp.config.themeMode === ThemeMode.dark) {
                WKApp.config.themeMode = ThemeMode.light;
              } else {
                WKApp.config.themeMode = ThemeMode.dark;
              }
            }}
          >{`${WKApp.config.themeMode === ThemeMode.dark ? "关闭" : "打开"
            }黑暗模式`}</li>
          <li
            onClick={() => {
              vm.settingSelected = false;
              if ((window as any).__POWERED_ELECTRON__) {
                (window as any).ipc.send("check-update");
              } else {
                if (vm.hasNewVersion) {
                  vm.showNewVersion = true;
                } else {
                  Toast.success("已经是最新版本");
                }
              }
            }}
          >
            检查版本&nbsp;v{WKApp.config.appVersion}&nbsp;
            {vm.hasNewVersion ? <Badge dot type="danger"></Badge> : undefined}
          </li>
          <li
            onClick={() => {
              vm.settingSelected = false;
              WKApp.shared.notificationIsClose =
                !WKApp.shared.notificationIsClose;
            }}
          >
            {WKApp.shared.notificationIsClose ? "打开" : "关闭"}桌面通知
          </li>
          <li
            onClick={() => {
              vm.settingSelected = false;
              WKApp.shared.logout();
            }}
          >
            退出登录
          </li>
        </ul>

        <Modal
          title="检测到新版本信息"
          visible={vm.showNewVersion}
          footer={null}
          onCancel={() => {
            vm.showNewVersion = false;
          }}
        >
          {vm.lastVersionInfo ? (
            <VersionCheckView lastVersion={vm.lastVersionInfo} />
          ) : undefined}
        </Modal>

        <Modal
          title="检测更新"
          visible={vm.showAppVersion}
          centered
          closeOnEsc={false}
          maskClosable={false}
          bodyStyle={{ overflow: "auto", height: 200 }}
          onCancel={() => {
            vm.showAppVersion = false;
            vm.notifyListener();
          }}
          footer={
            vm.showAppUpdateOperation ? (
              <>
                <Button
                  theme="solid"
                  type="tertiary"
                  onClick={() => {
                    vm.showAppVersion = false;
                    vm.notifyListener();
                  }}
                >
                  取消
                </Button>
                <Button
                  theme="solid"
                  type="primary"
                  onClick={() => {
                    vm.installUpdate();
                  }}
                >
                  更新
                </Button>
              </>
            ) : undefined
          }
        >
          {vm.lastVersionInfo ? (
            <div className="wk-versioncheckview">
              <div className="wk-versioncheckview-content">
                <div className="wk-versioncheckview-updateinfo">
                  <ul>
                    <li>
                      当前版本: {WKApp.config.appVersion} &nbsp;&nbsp;目标版本:{" "}
                      {vm.lastVersionInfo.appVersion}
                    </li>
                    <li>更新内容：</li>
                    <li>
                      <pre>{vm.lastVersionInfo.updateDesc}</pre>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          ) : undefined}
          {vm.showAppUpdate ? (
            <Progress
              percent={vm.appUpdateProgress}
              style={{ height: "8px" }}
              showInfo={true}
              aria-label="disk usage"
            />
          ) : undefined}
        </Modal>

        <Modal
          width={400}
          className="wk-main-sider-modal wk-main-sider-meinfo"
          footer={null}
          closeIcon={<div></div>}
          visible={vm.showMeInfo}
          mask={false}
          onCancel={() => {
            vm.showMeInfo = false;
          }}
        >
          <MeInfo
            onClose={() => {
              vm.showMeInfo = false;
            }}
          ></MeInfo>
        </Modal>
      </div>
    );
  }
}

interface VersionCheckViewProps {
  lastVersion: VersionInfo; // 最新版本
}
class VersionCheckView extends Component<VersionCheckViewProps> {
  render() {
    const { lastVersion } = this.props;
    return (
      <div className="wk-versioncheckview">
        <div className="wk-versioncheckview-content">
          <div className="wk-versioncheckview-updateinfo">
            <ul>
              <li>
                当前版本: {WKApp.config.appVersion} &nbsp;&nbsp;目标版本:{" "}
                {lastVersion.appVersion}
              </li>
              <li>更新内容：</li>
              <li>
                <pre>{lastVersion.updateDesc}</pre>
              </li>
            </ul>
          </div>
          <div className="wk-versioncheckview-tip">
            <div className="wk-versioncheckview-tip-title">更新方法：</div>
            <div className="wk-versioncheckview-tip-content">
              <ul>
                <li>
                  1. Windows系统中的某些浏览器: Ctrl + F5刷新。如Chrome谷
                  歌、Opera欧鹏、FireFox火狐浏览器等。
                </li>
                <li>2. MacOS系统的Safari浏览器: Command + Option + R刷新。</li>
                <li>
                  3. MacOS系统中的某些浏览器: Command + Shift +
                  R刷新。如Chrome谷歌、Opera欧鹏、 FireFox火狐浏览器等 。
                </li>
                <li>
                  {`4.浏览器打开"设置" -> "清理浏览数据" ->勾选"缓存的图片和
文件”(其他不勾选) -> "清理" ->刷新页面。`}
                </li>
                <li>5.若上述方法都不行，请直接清理浏览器的数据或缓存。</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
