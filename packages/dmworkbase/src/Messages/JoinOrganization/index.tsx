import { MessageContent } from "wukongimjssdk";
import React from "react";
import MessageBase from "../Base";
import MessageTrail from "../Base/tail";
import { MessageCell } from "../MessageCell";
import WKApp from "../../App";
import { I18nContext, t } from "../../i18n";

import "./index.css";

export class JoinOrganizationContent extends MessageContent {
  code!: string;
  inviter!: string;
  inviter_name!: string;
  org_id!: string;
  org_name!: string;
  decodeJSON(content: any) {
    this.code = content["code"] || "";
    this.inviter = content["inviter"] || "";
    this.inviter_name = content["inviter_name"] || "";
    this.org_id = content["org_id"] || "";
    this.org_name = content["org_name"];
  }

  get conversationDigest() {
    return t("base.message.digest.joinOrganization");
  }
}

export class JoinOrganizationCell extends MessageCell {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  render() {
    const { message, context } = this.props;
    const content = message.content as JoinOrganizationContent;
    return (
      <MessageBase message={message} context={context}>
        <div
          className="wk-join-oraganization"
          onClick={() => {
            WKApp.shared.baseContext.showJoinOrgInfo(
              content.org_id,
              content.inviter,
              content.code
            );
          }}
        >
          <div className="wk-join-oraganization-content">
            <div>
              <img
                src={WKApp.shared.avatarOrg(content.org_id)}
                style={{ width: "64px", height: "64px", borderRadius: "50%" }}
                alt=""
              />
            </div>
            <div className="wk-join-oraganization-content-name">
              {this.context.t("base.message.joinOrganization.inviteText", {
                values: { inviter: content.inviter_name, orgName: content.org_name },
              })}
            </div>
          </div>
          <div className="wk-join-oraganization-bottom">
            <div className="wk-join-oraganization-bottom-flag">{this.context.t("base.message.joinOrganization.join")}</div>
            <div className="wk-join-oraganization-bottom-time">
              <MessageTrail message={message} timeStyle={{ color: "#999" }} />
            </div>
          </div>
        </div>
      </MessageBase>
    );
  }
}
