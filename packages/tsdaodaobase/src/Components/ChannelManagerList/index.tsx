import { Popconfirm, Toast } from "@douyinfe/semi-ui";
import { Channel, ChannelTypePerson } from "wukongimjssdk/lib/sdk";
import React from "react";
import { Component, ReactNode } from "react";
import WKApp from "../../App";
import { GroupRole, SubscriberStatus } from "../../Service/Const";
import RouteContext, { FinishButtonContext } from "../../Service/Context";
import { ChannelSettingRouteData } from "../ChannelSetting/context";
import { IndexTableItem } from "../IndexTable";
import SmallTableEdit from "../SmallTableEdit";
import UserSelect from "../UserSelect";

import "./index.css"

export interface ChannelManagerListProps {
    routeContext: RouteContext<ChannelSettingRouteData>
}

export default class ChannelManagerList extends Component<ChannelManagerListProps> {


    render(): ReactNode {
        const { routeContext } = this.props
        const data = routeContext.routeData()


        return <div className="wk-channelmanagerlist">
            <SmallTableEdit addTitle="添加管理员" items={data.subscribers.filter((s) => {
                return s.role === GroupRole.manager || s.role === GroupRole.owner
            }).map((subscriber) => {
                return {
                    id: subscriber.uid,
                    icon: WKApp.shared.avatarUser(subscriber.uid),
                    name: subscriber.remark || subscriber.name,
                    showAction: subscriber.role !== GroupRole.owner,
                    onAction: () => {
                        WKApp.dataSource.channelDataSource.managerRemove(data.channel, [subscriber.uid]).catch((err) => {
                            Toast.error(err.msg)
                        })
                    }
                }
            })} onAdd={() => {
                var btnContext: FinishButtonContext
                var selectItems: IndexTableItem[] = []
                routeContext.push(<UserSelect onSelect={(items) => {
                    if (items.length === 0) {
                        btnContext.disable(true)
                    } else {
                        btnContext.disable(false)
                    }
                    selectItems = items

                }} users={data.subscribers.filter((subscriber) => subscriber.role !== GroupRole.manager && subscriber.role !== GroupRole.owner && subscriber.status === SubscriberStatus.normal).map((item) => {
                    return new IndexTableItem(item.uid, item.name, item.avatar)
                })}></UserSelect>, {
                    title: "选择管理员",
                    showFinishButton: true,
                    onFinish: async () => {
                        btnContext.loading(true)
                        await WKApp.dataSource.channelDataSource.managerAdd(data.channel, selectItems.map((item) => {
                            return item.id
                        })).catch((err) => {
                            Toast.error(err.msg)
                        })
                        btnContext.loading(false)
                        routeContext.pop()
                    },
                    onFinishContext: (context) => {
                        btnContext = context
                        btnContext.disable(true)
                    }
                })
            }}></SmallTableEdit>
        </div>
    }
}