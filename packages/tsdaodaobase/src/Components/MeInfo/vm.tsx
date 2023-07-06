import React from "react";
import QRCodeMy from "../QRCodeMy";
import WKApp from "../../App";
import RouteContext, { FinishButtonContext, RouteContextConfig } from "../../Service/Context";
import { ProviderListener } from "../../Service/Provider";
import { Row, Section } from "../../Service/Section";
import { InputEdit } from "../InputEdit";
import { ListItem, ListItemIcon } from "../ListItem";
import { Sex, SexSelect } from "../SexSelect";
import { ListItemAvatar } from "../ListItemAvatar";
import axios from "axios";
import { Toast } from "@douyinfe/semi-ui";
import WKSDK from "wukongimjssdk";
import { ChannelInfoListener } from "wukongimjssdk/lib/channel_manager";
import { ChannelInfo, ChannelTypePerson } from "wukongimjssdk/lib/model";
export class MeInfoVM extends ProviderListener {

    channelInfoListener!:ChannelInfoListener

    didMount(): void {
        this.channelInfoListener = (channelInfo:ChannelInfo)=>{
            if(channelInfo.channel.channelType !== ChannelTypePerson) {
                return
            }
            if(channelInfo.channel.channelID !== WKApp.loginInfo.uid) {
                return
            }
            WKApp.loginInfo.name = channelInfo.title;
            WKApp.loginInfo.shortNo = channelInfo.orgData.short_no;
            WKApp.loginInfo.sex = channelInfo.orgData.sex;
            WKApp.shared.myUserAvatarChange()
            this.notifyListener()
        }
        WKSDK.shared().channelManager.addListener(this.channelInfoListener)
    }

    didUnMount(): void {
        WKSDK.shared().channelManager.removeListener(this.channelInfoListener)
    }

    uploadAvatar(file: File) {
        const param = new FormData();
        param.append("file", file);
        return axios.post(`users/${WKApp.loginInfo.uid}/avatar`, param, {
            headers: { "Content-Type": "multipart/form-data", "token": WKApp.loginInfo.token || "" },
        }).catch(error => {
            console.log('文件上传失败！->', error);
        })
    }

    updateMyInfo(field: string, value: string) {
        let param: any = {}
        param[field] = value
        return WKApp.apiClient.put("user/current", param).catch((err) => {
            Toast.error(err.msg)
        })
    }

    inputEditPush(context: RouteContext<any>, defaultValue: string, onFinish: (value: string) => Promise<void>, placeholder?: string,maxCount?:number) {
        let value: string
        let finishButtonContext: FinishButtonContext
        context.push(<InputEdit maxCount={maxCount} defaultValue={defaultValue} placeholder={placeholder} onChange={(v) => {
            value = v
            if (!value || value === "") {
                finishButtonContext.disable(true)
            } else {
                finishButtonContext.disable(false)
            }
        }}></InputEdit>, new RouteContextConfig({
            showFinishButton: true,
            onFinishContext: (finishBtnContext) => {
                finishButtonContext = finishBtnContext
                finishBtnContext.disable(true)
            },
            onFinish: async () => {
                finishButtonContext.loading(true)
                await onFinish(value)
                finishButtonContext.loading(false)

                context.pop()
            }
        }))
    }

    sections(context: RouteContext<any>) {

        let sections = new Array<Section>()
        sections.push(new Section({
            rows: [
                new Row({
                    cell: ListItemAvatar,
                    properties: {
                        title: `头像`,
                        context: context,
                        avatar: <img style={{ "width": "24px", "height": "24px", "borderRadius": "50%" }} src={WKApp.shared.avatarUser(WKApp.loginInfo.uid || "")}></img>,
                        onFileUpload: async (f: File) => {
                            await this.uploadAvatar(f)
                            WKApp.shared.changeChannelAvatarTag()
                        }
                    }
                }),
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "名字",
                        subTitle: WKApp.loginInfo.name,
                        onClick: () => {
                            this.inputEditPush(context, WKApp.loginInfo.name || "", async (value) => {
                                if (value.trim() == "") {
                                    Toast.error("名字不能为空！")
                                    return
                                }
                                return this.updateMyInfo("name",value).then(()=>{
                                    WKApp.loginInfo.name = value
                                    WKApp.loginInfo.save()
                                })
                            }, "设置名字",20)
                        }
                    }
                }),
                new Row({
                    cell: ListItem,
                    properties: {
                        title: `${WKApp.config.appName}号`,
                        subTitle: WKApp.loginInfo.shortNo,
                        onClick: () => {

                        }
                    }
                }),
                new Row({
                    cell: ListItemIcon,
                    properties: {
                        title: `我的二维码`,
                        icon: <img style={{ "width": "24px", "height": "24px" }} src={require("./../../assets/icon_qrcode.png").default}></img>,
                        onClick: () => {
                            context.push(<QRCodeMy disableHeader={true}></QRCodeMy>)
                        }
                    }
                })
            ]
        }))

        let sex = WKApp.loginInfo.sex === 0 ? Sex.Female : Sex.Male
        let sexStr = "男"
        if (sex == Sex.Female) {
            sexStr = "女"
        }

        sections.push(new Section({
            rows: [
                new Row({
                    cell: ListItem,
                    properties: {
                        title: "性别",
                        subTitle: sexStr,
                        onClick: () => {
                            context.push(<SexSelect sex={sex} onSelect={ async (sex) => {
                                this.updateMyInfo("sex",sex.toString())
                                context.pop()
                                WKApp.loginInfo.sex = sex
                                WKApp.loginInfo.save()
                            }}></SexSelect>)
                        }
                    }
                }),
            ]
        }))

        return sections
    }
}