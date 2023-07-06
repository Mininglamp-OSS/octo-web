
export  class  EndpointID {
  static  loginWidget = "loginWidget"; // login widget
  static  homeWidget = "homeWidget"; // 主页
  static  routePrefix = "route:"; // 路由sid前缀
  static  menusPrefix = "menus:"; // 菜单前缀
  static conversationListItem = "conversationList.item" // 最近会话列表的item
  static showConversation = "showConversation" // 显示会话页面
  static clearChannelMessages :string = "clearChannelMessages" // 清空某个频道消息
  static emojiService = "emojiService" // emoji服务
}

export class EndpointCategory {
  static  routes = "routes"; // 路由
  static  menus = "menus"; // 菜单
  static channelSetting = "channelSetting" // 频道设置
  static userInfo = "userInfo" // 用户信息
  static channelManage= "channelManage" // 频道管理
  static contactsHeader = "contactsHeader"
  static messageContextMenus = "messageContextMenus" // 消息上下文菜单
  static friendApplyDataChange:string = "friendApplyDataChange" // 好友申请数据改变
  static chatMenusPopover:string = "chatMenusPopover" // 聊天菜单气泡
  static chatToolbars = "chatToolbars" // 聊天工具栏
 
}


export class GroupRole {
  static normal: number = 0 // 普通
  static owner: number = 1 // 群主
  static manager: number = 2 // 管理员
}

export class SubscriberStatus {
   static  unknown:number = 0// 未知
   static  normal:number = 1// 正常
   static  blacklist:number = 2// 黑名单
}


export class MessageContentTypeConst {
  static historySplit: number = - 3 // 历史风格线
  static typing: number = - 2 // 输入中
  static time: number = - 1 // 时间消息
  static image: number = 2 // 图片消息
  static gif: number = 3 // gif消息
  static voice: number = 4 // 语音消息
  static smallVideo: number = 5 // 小视频
  static location: number = 6 // 位置信息
  static card: number = 7 // 名片
  static file: number = 8 // 文件
  static mergeForward: number = 11 // 合并转发
  static lottieSticker: number = 12 // lottie贴图
  static lottieEmojiSticker: number = 13 // lottie emoji 贴图
  static addMembers: number = 1002 // 添加群成员
  static removeMembers: number = 1003 // 删除群成员
  static channelUpdate: number = 1005 // 频道更新
  static newGroupOwner: number = 1008 // 成为新群主
  static screenshot:number = 1014 // 截屏消息
  
}

// 用户关系
export class UserRelation {
    static stranger:number = 0 // 陌生人
    static friend:number = 1 // 好友
    static blacklist:number = 2 // 拉黑
}

// 网页端暂不支持的消息
export const unsupportMessageTypes = []


export enum MessageReasonCode {
  	// ReasonUnknown 未知错误
	reasonUnknown, 
	// ReasonSuccess 成功
	reasonSuccess,
	// ReasonAuthFail 认证失败
	reasonAuthFail,
	// ReasonSubscriberNotExist 订阅者在频道内不存在
	reasonSubscriberNotExist,
	// ReasonInBlacklist 在黑名单列表里
	reasonInBlacklist,
	// ReasonChannelNotExist 频道不存在
	reasonChannelNotExist,
	// ReasonUserNotOnNode 用户没在节点上
	reasonUserNotOnNode,
	// ReasonSenderOffline // 发送者离线了，这条消息将发不成功
	reasonSenderOffline,
	// ReasonMsgKeyError 消息key错误 说明消息不合法
	reasonMsgKeyError,
	// ReasonPayloadDecodeError payload解码失败
	reasonPayloadDecodeError,
	// ReasonForwardSendPacketError 转发发送包失败
	reasonForwardSendPacketError,
	// ReasonNotAllowSend 不允许发送消息
	reasonNotAllowSend,
	// ReasonConnectKick 连接被踢
	reasonConnectKick,
	// ReasonNotInWhitelist 没在白名单内
	reasonNotInWhitelist,
	// 查询用户token错误
	reasonQueryTokenError,
	// 系统错误
	reasonSystemError,
	// ReasonError
}

export const OrderFactor = 10000 // 排序因子

export const ChannelTypeCustomerService = 3 // 客服频道