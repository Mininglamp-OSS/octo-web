import { ChannelQrcodeResp, Contacts, IChannelDataSource, ICommonDataSource, WKApp, RequestConfig } from "@tsdaodao/base";
import { Channel, ChannelInfo, ChannelTypeGroup, ChannelTypePerson, WKSDK, Message, MessageContentType,ConversationExtra } from "wukongimjssdk";

export class ChannelDataSource implements IChannelDataSource {

    async exitChannel(channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.post(`groups/${channel.channelID}/exit`)
    }

    async channelTransferOwner(channel: Channel, toUID: string): Promise<void> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.post(`groups/${channel.channelID}/transfer/${toUID}`)
    }

    async subscriberAttrUpdate(channel: Channel, subscriberUID: string, attr: any): Promise<any> {
        if (channel.channelType === ChannelTypePerson) {
            return
        }
        return WKApp.apiClient.put(`groups/${channel.channelID}/members/${subscriberUID}`, attr)
    }
    createChannel(uids: string[]): Promise<any> {
        return WKApp.apiClient.post(`group/create`, { members: uids });
    }
    async groupSaveList(): Promise<ChannelInfo[]> {
        const resp = await WKApp.apiClient.get('group/my', {
            param: {
                "limit": 100000,
            }
        });
        const channelInfos = [];
        if (resp) {

            if (resp.length === 0) return [];
            for (const data of resp) {
                let channelInfo = new ChannelInfo();
                channelInfo.channel = new Channel(data.group_no, ChannelTypeGroup);
                channelInfo.title = data.name;
                channelInfo.logo = WKApp.shared.avatarChannel(channelInfo.channel);
                channelInfo.mute = data.mute === 1;
                channelInfo.top = data.top === 1;
                channelInfo.orgData = data;
                if (!channelInfo.orgData) {
                    channelInfo.orgData = {}
                }
                if (channelInfo.orgData.remark && channelInfo.orgData.remark !== "") {
                    channelInfo.orgData.displayName = channelInfo.orgData.remark;
                } else {
                    channelInfo.orgData.displayName = channelInfo.title;
                }

                channelInfos.push(channelInfo);
            }
        }
        return channelInfos;
    }
    removeSubscribers(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/members`, {
            data: {
                members: uids,
            }
        })
    }
    addSubscribers(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/members`, {
            members: uids,
        })
    }

    updateField(channel: Channel, field: string, value: string): Promise<void> {
        const param: any = {}
        param[field] = value
        return WKApp.apiClient.put(`groups/${channel.channelID}`, param)
    }

    qrcode(channel: Channel): Promise<ChannelQrcodeResp> {
        return WKApp.apiClient.get(`groups/${channel.channelID}/qrcode`, {
            resp: () => {
                return new ChannelQrcodeResp()
            }
        })
    }

    async updateSetting(setting: any, channel: Channel): Promise<void> {
        if (channel.channelType === ChannelTypeGroup) {
            return WKApp.apiClient.put(`groups/${channel.channelID}/setting`, setting)
        } else if (channel.channelType === ChannelTypePerson) { // 个人信息
            return WKApp.apiClient.put(`users/${channel.channelID}/setting`, setting)
        }
    }

    async managerRemove(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.delete(`groups/${channel.channelID}/managers`, {
            data: uids,
        })
    }

    async managerAdd(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/managers`, uids)
    }

    blacklistAdd(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/blacklist/add`, { uids: uids })
    }


    blacklistRemove(channel: Channel, uids: string[]): Promise<void> {
        return WKApp.apiClient.post(`groups/${channel.channelID}/blacklist/remove`, { uids: uids })
    }

    conversationExtraUpdate(conversationExtra:ConversationExtra): Promise<void> {
        return WKApp.apiClient.post(`conversations/${conversationExtra.channel.channelID}/${conversationExtra.channel.channelType}/extra`,{
            "browse_to": conversationExtra.browseTo,
            "keep_message_seq": conversationExtra.keepMessageSeq,
            "keep_offset_y": conversationExtra.keepOffsetY,
            "draft": conversationExtra.draft||""

        })
    }
}

export class CommonDataSource implements ICommonDataSource {
    blacklistAdd(uid: string): Promise<void> {
        return WKApp.apiClient.post(`user/blacklist/${uid}`)
    }
    blacklistRemove(uid: string): Promise<void> {
        return WKApp.apiClient.delete(`user/blacklist/${uid}`)
    }
    deleteFriend(uid:string): Promise<void> {
        return WKApp.apiClient.delete(`friends/${uid}`)
    }

    userRemark(uid: string, remark: string): Promise<void> {
        return WKApp.apiClient.put(`friend/remark`, { uid: uid, remark: remark })
    }
    getFavoritesAll(): Promise<any> {
        // TODO: 这里先取10000足够 等后面再做分页
        return WKApp.apiClient.get(`favorite/my?page_index=1&page_size=10000`)
    }
    favorities(message: Message): Promise<void>{
        var content: string = ""
        if (message.contentType === MessageContentType.text) {
            content = message.content.contentObj.content;
        } else if (message.contentType === MessageContentType.image) {
            content = message.content.contentObj.url;
        }
        const fromChannelInfo = WKSDK.shared().channelManager.getChannelInfo(new Channel(message.fromUID, ChannelTypePerson))
        return WKApp.apiClient.post(`favorites`, {
            type: message.contentType,
            unique_key: message.messageID,
            author_name: fromChannelInfo?.title || "",
            author_uid: message.fromUID,
            payload: { content: content },
        })
    }
    favoritiesDelete(id: string): Promise<void> {
        return WKApp.apiClient.delete(`favorites/${id}`)
    }
    userStickerCategory(): Promise<any> {
        return WKApp.apiClient.get(`sticker/user/category`)
    }
    getStickers(category: string): Promise<any> {
        return WKApp.apiClient.get(`sticker/user/sticker?category=${category}`)
    }
    searchUser(keyword: string): Promise<any> {
        return WKApp.apiClient.get(`user/search?keyword=${keyword}`)
    }
    qrcodeMy(): Promise<any> {
        return WKApp.apiClient.get("user/qrcode")
    }

    friendSure(token: string): Promise<void> {
        return WKApp.apiClient.post("friend/sure", {
            "token": token,
        })
    }

    friendApply(req:{uid:string,remark:string,vercode:string}):Promise<void> {
        return WKApp.apiClient.post(`friend/apply`,{to_uid:req.uid,remark:req.remark,vercode:req.vercode},)
    }

    /**
    *  获取图片完整地址
    * @param path  图片路径
    * @param opts 参数
    */
    getImageURL(path: string, opts?: { width: number, height: number }): string {
        if (path && path.length > 4) {
            const prefix = path.substring(0, 4)
            if (prefix === 'http') {
                return path
            }
        }
        const baseURl = WKApp.apiClient.config.apiURL
        return `${baseURl}${path}`
    }
    getFileURL(path: string): string {
        if (path && path.length > 4) {
            const prefix = path.substring(0, 4)
            if (prefix === 'http') {
                return path
            }
        }
        const baseURl = WKApp.apiClient.config.apiURL
        return `${baseURl}${path}`
    }


    async contactsSync(version: string): Promise<Contacts[]> {
        const results = await WKApp.apiClient.get(`friend/sync`, {
            param: { version: version,"api_version":"1" },
        })
        const contactsList = new Array<Contacts>()
        if (results) {
            for (const result of results) {
                contactsList.push(this.toContacts(result))
            }
        }
        return contactsList

    }
    imConnectAddr(): Promise<string> {
        return WKApp.apiClient.get(`users/${WKApp.loginInfo.uid}/im`).then((resp) => {
            let addr = resp.wss_addr
            if(!addr || addr==='') {
                addr =  resp.ws_addr
            }
            return addr
        });
    }
    imConnectAddrs(): Promise<string[]> {
        return WKApp.apiClient.get(`users/${WKApp.loginInfo.uid}/im`).then((resp) => {
            let addr = resp.wss_addr
            if(!addr || addr==='') {
                addr =  resp.ws_addr
            }
            return [addr]
        });
    }

    toContacts(resultDic: any): Contacts {
        const contacts = new Contacts()
        contacts.uid = resultDic["uid"] || ""
        contacts.name = resultDic["name"] || ""
        contacts.remark = resultDic["remark"] || ""
        if (resultDic["version"]) {
            contacts.version = resultDic["version"] + ""
        }
        contacts.avatar = WKApp.shared.avatarUser(contacts.uid)
        contacts.status = resultDic["status"] || 0
        contacts.follow = resultDic["follow"] || 0
        contacts.vercode = resultDic["vercode"] || ""

        return contacts
    }

    async searchFriends(keyword?: string): Promise<ChannelInfo[]> {
        let resp = await WKApp.apiClient.get('friend/sync', {
            param: {
                "keyword": keyword,
                "api_version":"1"
            }
        })
        const channelInfos = [];
        if (resp) {
            for (const data of resp) {
                if (data.is_deleted === 1) {
                    continue
                }
                let channelInfo = new ChannelInfo();
                channelInfo.channel = new Channel(data.uid, ChannelTypePerson);
                channelInfo.title = data.name;
                channelInfo.logo = WKApp.shared.avatarChannel(channelInfo.channel);
                channelInfo.mute = data.mute === 1;
                channelInfo.top = data.top === 1;
                channelInfo.orgData = data;
                if (!channelInfo.orgData) {
                    channelInfo.orgData = {}
                }
                if (channelInfo.orgData.remark && channelInfo.orgData.remark !== "") {
                    channelInfo.orgData.displayName = channelInfo.orgData.remark;
                } else {
                    channelInfo.orgData.displayName = channelInfo.title;
                }

                channelInfos.push(channelInfo);
            }
        }
        return channelInfos;
    }

}