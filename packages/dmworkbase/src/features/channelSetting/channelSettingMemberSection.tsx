import { Toast } from "@douyinfe/semi-ui";
import {
  ChannelTypePerson,
  Subscriber,
} from "wukongimjssdk";

import { ChannelSettingRouteData } from "../../Components/ChannelSetting/context";
import { IndexTableItem } from "../../Components/IndexTable";
import { Subscribers } from "../../Components/Subscribers";
import { SubscriberList } from "../../Components/Subscribers/list";
import { ContactsSelect } from "../../Components/UserSelect";
import {
  ChannelTypeCommunityTopic,
  ChannelTypeCustomerService,
} from "../../Service/Const";
import RouteContext, { FinishButtonContext } from "../../Service/Context";
import { Row, Section } from "../../Service/Section";
import { isGroupDisbanded } from "../../Utils/groupDisband";
import { t } from "../../i18n";
import {
  addChannelSettingSubscribers,
  createGroupFromChannelSettingPrivateChat,
  removeChannelSettingSubscribers,
} from "../../bridge/channelSetting/channelSettingActions";

export function buildChannelMembersSection(
  context: RouteContext<ChannelSettingRouteData>
) {
  const data = context.routeData() as ChannelSettingRouteData;
  const channel = data.channel;

  if (
    channel.channelType === ChannelTypeCustomerService ||
    channel.channelType === ChannelTypeCommunityTopic
  ) {
    return undefined;
  }

  if (isGroupDisbanded(data.channelInfo)) {
    return undefined;
  }

  let addFinishButtonContext: FinishButtonContext;
  let removeFinishButtonContext: FinishButtonContext;
  let addSelectItems: IndexTableItem[] = [];
  let removeSelectItems: Subscriber[] = [];
  const disableSelectList = data.subscribers.map((subscriber) => {
    return subscriber.uid;
  });

  return new Section({
    rows: [
      new Row({
        cell: Subscribers,
        properties: {
          context,
          channel,
          key: channel.getChannelKey(),
          canManageBotAdmin: !!data.channelInfo?.orgData?.can_manage_bot_admin,
          onAdd: () => {
            context.push(
              <ContactsSelect
                onSelect={(items) => {
                  addSelectItems = items;
                  addFinishButtonContext.disable(items.length === 0);
                }}
                disableSelectList={disableSelectList}
              />,
              {
                title: t("base.module.channelSettings.contactSelect"),
                showFinishButton: true,
                onFinish: async () => {
                  addFinishButtonContext.loading(true);

                  if (channel.channelType === ChannelTypePerson) {
                    await createGroupFromChannelSettingPrivateChat({
                      channel,
                      selectedUids: addSelectItems.map((item) => item.id),
                    }).catch((err) => {
                      Toast.error(err.msg);
                    });
                  } else {
                    await addChannelSettingSubscribers({
                      channel,
                      uids: addSelectItems.map((item) => item.id),
                    });
                    context.pop();
                  }
                  addFinishButtonContext.loading(false);
                },
                onFinishContext: (finishButtonContext) => {
                  addFinishButtonContext = finishButtonContext;
                  addFinishButtonContext.disable(true);
                },
              }
            );
          },
          onRemove: () => {
            context.push(
              <SubscriberList
                channel={channel}
                onSelect={(items) => {
                  removeSelectItems = items;
                  removeFinishButtonContext.disable(items.length === 0);
                }}
                canSelect={true}
              />,
              {
                title: t("base.module.channelSettings.removeMembers"),
                showFinishButton: true,
                onFinish: async () => {
                  removeFinishButtonContext.loading(true);
                  removeChannelSettingSubscribers({
                    channel,
                    uids: removeSelectItems.map((item) => item.uid),
                  })
                    .then(() => {
                      removeFinishButtonContext.loading(false);
                      context.pop();
                    })
                    .catch((err) => {
                      Toast.error(err.msg);
                    });
                },
                onFinishContext: (finishButtonContext) => {
                  removeFinishButtonContext = finishButtonContext;
                  removeFinishButtonContext.disable(true);
                },
              }
            );
          },
        },
      }),
    ],
  });
}
