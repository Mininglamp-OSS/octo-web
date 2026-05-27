import { WKApp, WKViewQueueHeader, Provider, I18nContext, t } from "@octo/base";
import React from "react";
import { Component, ReactNode } from "react";
import "./index.css";
import { GroupSaveVM } from "./vm";
import { Button, Toast } from "@douyinfe/semi-ui";
import { IndexTableItem, ContactsSelect } from "@octo/base";
import { FinishButtonContext } from "@octo/base/src/Service/Context";

export default class GroupSave extends Component {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  render(): ReactNode {
    return (
      <Provider
        create={() => {
          return new GroupSaveVM();
        }}
        render={(vm: GroupSaveVM) => {
          return (
            <div className="wk-groupsave">
              <WKViewQueueHeader
                title={t("contacts.header.savedGroups")}
                onBack={() => {
                  WKApp.routeLeft.pop();
                }}
                action={
                  <div className="wk-viewqueueheader-content-action">
                    <Button
                      size="small"
                      onClick={() => {
                        var selectItems: IndexTableItem[];
                        var finishButtonContext: FinishButtonContext;
                        WKApp.routeLeft.push(
                          <ContactsSelect
                            showFinishButton={true}
                            onFinishButtonContext={(context) => {
                              finishButtonContext = context;
                            }}
                            onSelect={(items) => {
                              selectItems = items;
                            }}
                            showHeader={true}
                            onBack={() => {
                              WKApp.routeLeft.pop();
                            }}
                            onFinished={() => {
                              if (selectItems && selectItems.length > 0) {
                                finishButtonContext.loading(true);
                                WKApp.dataSource.channelDataSource
                                  .createChannel(
                                    selectItems.map((item) => {
                                      return item.id;
                                    })
                                  )
                                  .then(() => {
                                    finishButtonContext.loading(false);
                                    WKApp.routeLeft.pop();
                                  })
                                  .catch((err) => {
                                    Toast.error(err.msg);
                                    finishButtonContext.loading(false);
                                  });
                              }
                            }}
                          ></ContactsSelect>
                        );
                      }}
                    >
                      {t("contacts.groupSave.createGroup")}
                    </Button>
                  </div>
                }
              ></WKViewQueueHeader>
              <div className="wk-groupsave-content">
                <ul>
                  {vm.groups.map((g) => {
                    return (
                      <li
                        key={g.channel.channelID}
                        onClick={() => {
                          WKApp.endpoints.showConversation(g.channel);
                        }}
                      >
                        <div className="wk-groupsave-content-avatar">
                          <img src={WKApp.shared.avatarChannel(g.channel)} alt="" />
                        </div>
                        <div className="wk-groupsave-content-title">
                          {g.title}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          );
        }}
      ></Provider>
    );
  }
}
