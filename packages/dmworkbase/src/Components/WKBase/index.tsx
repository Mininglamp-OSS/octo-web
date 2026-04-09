import { Modal } from "@douyinfe/semi-ui";
import WKModal from "../WKModal";
import { Channel } from "wukongimjssdk";
import React, { Component, HTMLProps, ReactNode } from "react";
import ConversationSelect from "../ConversationSelect";
import UserInfo from "../UserInfo";
import WKApp from "../../App";
import "./index.css";

export interface WKBaseState {
  showUserInfo?: boolean;
  userUID?: string;
  vercode?: string; // 加好友的验证码
  fromChannel?: Channel;
  showConversationSelect?: boolean;
  conversationSelectTitle?: string;
  showAlert?: boolean;
  alertContent?: string;
  alertTitle?: string;
  onAlertOk?: () => void;
  conversationSelectFinished?: (channel: Channel[]) => void;

  showGlobalModal?: boolean; // 显示全局弹窗
  globalModalOptions?: GlobalModalOptions;

  showJoinOrgInfo?: boolean;
  orgId?: string;
  orgCode?: string;
  orgUid?: string;
}

export class GlobalModalOptions {
  width?: string;
  height?: string;
  body?: ReactNode;
  footer?: ReactNode;
  className?: string;
  closable?: boolean;
  onCancel?: () => void;
}

export interface WKBaseProps {
  children: React.ReactNode;
  onContext?: (context: WKBaseContext) => void;
}

export interface WKBaseContext {
  // 显示最近会话选择
  showConversationSelect(
    onFinished?: (channels: Channel[]) => void,
    title?: string
  ): void;

  // 显示用户信息
  showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void;
  // 隐藏用户信息
  hideUserInfo(): void;
  // 弹出提示框
  showAlert(conf: { content: string; title?: string; onOk?: () => void }): void;

  showGlobalModal(options: GlobalModalOptions): void;

  // 显示加入组织
  showJoinOrgInfo(org_id: string, uid: string, code: string): void;

  hideGlobalModal(): void;
}

export default class WKBase
  extends Component<WKBaseProps, WKBaseState>
  implements WKBaseContext
{
  constructor(props: any) {
    super(props);
    this.state = {};
  }
  showUserInfo(uid: string, fromChannel?: Channel, vercode?: string): void {
    this.setState({
      showUserInfo: true,
      userUID: uid,
      fromChannel: fromChannel,
      vercode: vercode,
    });
  }

  showAlert(conf: {
    content: string;
    title?: string;
    onOk?: () => void;
  }): void {
    this.setState({
      alertContent: conf.content,
      alertTitle: conf.title,
      onAlertOk: conf.onOk,
      showAlert: true,
    });
  }

  showConversationSelect(
    onFinished?: (channels: Channel[]) => void,
    title?: string
  ) {
    this.setState({
      showConversationSelect: true,
      conversationSelectFinished: onFinished,
      conversationSelectTitle: title,
    });
  }

  hideUserInfo() {
    this.setState({
      showUserInfo: false,
      userUID: undefined,
      vercode: undefined,
    });
  }

  showGlobalModal(options: GlobalModalOptions) {
    this.setState({
      showGlobalModal: true,
      globalModalOptions: options,
    });
  }
  hideGlobalModal() {
    this.setState({
      showGlobalModal: false,
    });
  }

  componentDidMount() {
    const { onContext } = this.props;
    if (onContext) {
      onContext(this);
    }
  }

  cancelAlert() {
    this.setState({
      showAlert: false,
      alertContent: undefined,
      alertTitle: undefined,
      onAlertOk: undefined,
    });
  }

  showJoinOrgInfo(org_id: string, uid: string, code: string) {
    this.setState({
      showJoinOrgInfo: true,
      orgId: org_id,
      orgCode: code,
      orgUid: uid,
    });
  }

  render(): ReactNode {
    const {
      showUserInfo,
      userUID,
      fromChannel,
      vercode,
      showConversationSelect,
      conversationSelectTitle,
      conversationSelectFinished,
      onAlertOk,
      alertContent,
      alertTitle,
      showJoinOrgInfo,
      orgId,
      orgCode,
      orgUid,
    } = this.state;
    const baseURL = WKApp.apiClient.config.apiURL.replace("v1/", "");
    return (
      <div className="wk-base">
        {this.props.children}
        <WKModal
          className="wk-base-modal-userinfo wk-base-modal"
          visible={showUserInfo}
          options={{ mask: false, closable: false }}
          onCancel={() => {
            this.setState({
              showUserInfo: false,
              userUID: undefined,
            });
          }}
        >
          {userUID && userUID !== "" ? (
            <UserInfo
              fromChannel={fromChannel}
              vercode={vercode}
              uid={userUID}
              onClose={() => {
                this.setState({
                  showUserInfo: false,
                  userUID: undefined,
                });
              }}
            ></UserInfo>
          ) : undefined}
        </WKModal>

        <WKModal
          className="wk-base-modal"
          visible={showConversationSelect}
          options={{ mask: false }}
          onCancel={() => {
            this.setState({
              showConversationSelect: false,
            });
          }}
        >
          <ConversationSelect
            onFinished={(channels: Channel[]) => {
              this.setState({
                showConversationSelect: false,
              });
              if (conversationSelectFinished) {
                conversationSelectFinished(channels);
              }
            }}
            title={conversationSelectTitle}
          ></ConversationSelect>
        </WKModal>

        <WKModal
          title={alertTitle}
          visible={this.state.showAlert}
          onCancel={() => { this.cancelAlert(); }}
          options={{ maskClosable: false }}
          footerConfig={{
            onOk: () => {
              if (onAlertOk) { onAlertOk(); }
              this.cancelAlert();
            },
          }}
        >
          {alertContent}
        </WKModal>
        <Modal
          closable={this.state.globalModalOptions?.closable}
          className={this.state.globalModalOptions?.className}
          visible={this.state.showGlobalModal}
          width={this.state.globalModalOptions?.width}
          footer={this.state.globalModalOptions?.footer}
          onCancel={this.state.globalModalOptions?.onCancel}
        >
          {this.state.globalModalOptions?.body}
        </Modal>
        {/* 加入组织 */}
        <WKModal
          visible={showJoinOrgInfo}
          title="加入组织"
          className="wk-base-modal-join-org"
          options={{ mask: false }}
          onCancel={() => {
            this.setState({
              showJoinOrgInfo: false,
              orgId: undefined,
              orgUid: undefined,
              orgCode: undefined,
            });
          }}
        >
          {orgId && orgUid && orgCode && (
            <iframe
              src={`${baseURL}web/join_org.html?org_id=${encodeURIComponent(orgId)}&uid=${encodeURIComponent(orgUid)}&code=${encodeURIComponent(orgCode)}`}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: "100%", height: "100%", border: "none" }}
            ></iframe>
          )}
        </WKModal>
      </div>
    );
  }
}
