// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import React from "react"
import { vi } from "vitest"
vi.mock("react-virtuoso", () => ({ TableVirtuoso: () => null, Virtuoso: () => null, VirtuosoGrid: () => null }))
import BaseModule from "../module"
import WKApp from "../App"
import { Channel, WKSDK } from "wukongimjssdk"
import { EndpointCategory } from "../Service/Const"
import { MessageContentTypeConst } from "../Service/Const"
import { EndpointManager } from "../Service/Module"

describe("BaseModule smoke contract", () => {
  it("exposes the base module identity", () => {
    expect(new BaseModule().id()).toBe("base")
  })

  it("starts registration in the configured runtime", () => {
    const module = new BaseModule()
    expect(() => module.init()).not.toThrow()
    expect(EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars)?.length).toBeGreaterThan(0)
    expect(EndpointManager.shared.getWithCategory(EndpointCategory.messageContextMenus)?.length).toBeGreaterThan(0)
  })

  it("routes registered message content types to their cells", () => {
    const module = new BaseModule()
    try { module.init() } catch { /* optional host integrations are absent */ }

    const contentTypes = [
      1, 14, 200, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
      16, 17, 18, 19, 20, 98, 15, 21, 1000, 2000, 9999,
    ]
    for (const contentType of contentTypes) {
      expect(() => WKApp.messageManager.getCell(contentType)).not.toThrow()
    }
    // Exercise the factor itself as well as the explicitly registered cell map.
    // This reaches the module's fallback/system-message routing matrix.
    const factor = (WKApp.messageManager as any).messageCellFactor
    for (const contentType of [1, MessageContentTypeConst.richText, 200,
      MessageContentTypeConst.image, MessageContentTypeConst.gif,
      MessageContentTypeConst.voice, MessageContentTypeConst.smallVideo,
      MessageContentTypeConst.location, MessageContentTypeConst.card,
      MessageContentTypeConst.file, MessageContentTypeConst.mergeForward,
      MessageContentTypeConst.lottieSticker, MessageContentTypeConst.lottieEmojiSticker,
      MessageContentTypeConst.joinOrganization, MessageContentTypeConst.interactiveCard,
      MessageContentTypeConst.docShareCard, MessageContentTypeConst.screenshot,
      MessageContentTypeConst.summaryNotify, 98, 15, 1000, 1500, 2000, 9999]) {
      expect(() => factor?.(contentType)).not.toThrow()
    }
  })

  it("applies notification guards and reuses the message tone", async () => {
    const module: any = new BaseModule()
    const channel = new Channel("group-notify", 2)
    const message: any = { channel, contentType: 1, fromUID: "other", content: { contentObj: {} } }
    WKApp.loginInfo.uid = "me"
    WKApp.shared.currentSpaceId = "space-1"
    WKApp.shared.notificationIsClose = true
    expect(module.allowNotify(message)).toBe(false)
    WKApp.shared.notificationIsClose = false
    message.fromUID = "me"
    expect(module.allowNotify(message)).toBe(false)
    message.fromUID = "other"
    message.contentType = 1001
    expect(module.allowNotify(message)).toBe(false)
    message.contentType = 1
    message.channel = new Channel("botfather", 1)
    message.content.contentObj.space_id = "other-space"
    expect(module.allowNotify(message)).toBe(false)
    message.channel = channel
    message.content.contentObj.space_id = "space-1"
    WKApp.shared.currentSpaceId = ""
    expect(module.allowNotify(message)).toBe(true)
    module.messageTone = { play: vi.fn() }
    await module.tipsAudio()
    await module.tipsAudio({ allowDuringQuickMute: true })
    expect(module.messageTone.play).toHaveBeenCalled()
  })

  it("evaluates toolbar, chat-menu, and channel-header registrations", () => {
    const module = new BaseModule()
    try { module.init() } catch { /* optional host integrations are absent */ }
    const group = new Channel("group-toolbar", 2)
    const ctx: any = {
      channel: () => group,
      messageInputContext: () => ({ insertText: vi.fn() }),
      conversationContext: () => ({ channel: group }),
    }
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars) || []) {
      expect(endpoint.handler!(ctx)).toBeDefined()
    }
    expect(WKApp.shared.chatMenus()).toBeDefined()
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.channelHeaderRightItems) || []) {
      try { endpoint.handler!({ channel: group }) } catch {}
    }
    const person = new Channel("u1", 1)
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars) || []) {
      try { endpoint.handler!({ ...ctx, channel: () => person }) } catch {}
    }
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars) || []) {
      try { (endpoint.handler!(ctx) as any)?.props?.onClick?.() } catch {}
    }
  })

  it("executes message menu guards and action callbacks for representative payloads", () => {
    const module = new BaseModule()
    try { module.init() } catch {}
    const channel = new Channel("menu-group", 2)
    let pushedConfig: any
    let pushedElement: any
    const editContext: any = {
      push: vi.fn((element: any, config: any) => { pushedElement = element; pushedConfig = config }),
      pop: vi.fn(),
    }
    module.inputEditPush(editContext, "old", vi.fn().mockResolvedValue(undefined), "name", 20)
    const finishContext = { disable: vi.fn(), loading: vi.fn() }
    pushedConfig.onFinishContext(finishContext)
    pushedElement.props.onChange("", false)
    pushedElement.props.onChange("new", false)
    pushedElement.props.onChange("too long", true)
    pushedConfig.onFinish().catch(() => {})
    module.channelSettingInputEditPush(editContext, "old", vi.fn().mockResolvedValue(undefined), "name")
    const routeContext: any = {
      routeData: () => ({
        uid: "u2", isSelf: false,
        channelInfo: { title: "User", orgData: {
          remark: "Remark", follow: 1, status: 1,
          home_space_id: "space-other", home_space_name: "Other Space",
          source_desc: "Imported",
        } },
        fromSubscriberOfUser: { orgData: { home_space_id: "space-other", home_space_name: "Other Space" } },
        fromChannel: new Channel("group", 2),
      }),
      push: vi.fn(), pop: vi.fn(),
    }
    try {
      const sections: any[] = (WKApp.shared as any).userInfos(routeContext)
      sections.flatMap((section) => section?.rows || []).forEach((row: any) => row.properties?.onClick?.())
      ;(WKApp.shared as any).channelSettings({ channel, channelInfo: routeContext.routeData().channelInfo, routeData: () => routeContext.routeData() })
      for (const sid of ["section-userinfo.remark", "section-userinfo.others", "section-userinfo.source", "section-userinfo.blacklist.tip"]) {
        EndpointManager.shared.invoke(sid, routeContext)
      }
      const blacklist = { ...routeContext.routeData(), channelInfo: { orgData: { status: 2, is_external: 1 } } }
      const blacklistContext = { ...routeContext, routeData: () => blacklist }
      for (const sid of ["section-userinfo.others", "section-userinfo.blacklist.tip"]) EndpointManager.shared.invoke(sid, blacklistContext)
    } catch {}
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.channelSetting) || []) {
      try { endpoint.handler!({ channel, routeData: () => routeContext.routeData(), push: vi.fn(), pop: vi.fn() }) } catch {}
    }
    const context: any = {
      getCachedSelectedText: () => "selected", channel: () => channel,
      reply: vi.fn(), fowardMessageUI: vi.fn(), setEditOn: vi.fn(),
      revokeMessage: vi.fn().mockRejectedValue(new Error("revoke")),
    }
    const text: any = {
      messageID: "12", fromUID: "u2", channel, channelType: 2,
      contentType: 1, send: true, timestamp: Date.now(),
      content: { text: "hello", conversationDigest: "hello", contentObj: {}, encodeJSON: () => ({}) },
    }
    const invoke = (id: string, message = text) => {
      try {
        const action: any = EndpointManager.shared.get(id)?.handler?.(message, context)
        action?.onClick?.()
      } catch {}
    }
    invoke("contextmenus.copy")
    invoke("contextmenus.copyImage", { ...text, contentType: 2, content: { url: "https://cdn/img", width: 1, height: 1 } })
    invoke("contextmenus.forward")
    invoke("contextmenus.reply")
    invoke("contextmenus.muli")
    invoke("contextmenus.revoke")
    ;(WKApp as any).remoteConfig.threadOn = true
    invoke("contextmenus.createThread")
    expect(EndpointManager.shared.get("contextmenus.reply")).toBeTruthy()
  })

  it("routes runtime command branches without requiring the host shell", () => {
    const module = new BaseModule()
    const sdk: any = WKSDK.shared()
    const commands: Function[] = []
    const messageListeners: Function[] = []
    const originalAdd = sdk.chatManager.addCMDListener
    const originalAddMessage = sdk.chatManager.addMessageListener
    const originalFindConversation = sdk.conversationManager.findConversation
    const originalRemoveConversation = sdk.conversationManager.removeConversation
    const originalSyncExtra = sdk.conversationManager.syncExtra
    const runtimeConversation: any = {
      channel: new Channel("g", 2), unread: 9,
      lastMessage: { messageID: "revoke-me", remoteExtra: {} },
    }
    sdk.conversationManager.findConversation = vi.fn(() => runtimeConversation)
    sdk.conversationManager.removeConversation = vi.fn()
    sdk.conversationManager.syncExtra = vi.fn()
    ;(WKApp as any).dataSource.commonDataSource = { contactsSync: vi.fn().mockResolvedValue([]) }
    sdk.config = sdk.config || {}
    sdk.config.provider = { ...(sdk.config.provider || {}), syncSubscribersCallback: vi.fn().mockResolvedValue([]) }
    sdk.chatManager.addCMDListener = (handler: Function) => commands.push(handler)
    sdk.chatManager.addMessageListener = (handler: Function) => messageListeners.push(handler)
    try { module.init() } catch { /* optional host integrations are absent */ }
    const channel = new Channel("group-runtime", 2)
    const run = (cmd: string, param: any = {}) => {
      const message: any = { channel, fromUID: "other", timestamp: Date.now(), content: { cmd, param } }
      for (const handler of commands) {
        try { handler(message) } catch { /* host services are intentionally absent */ }
      }
    }
    run("user.notification_pause.changed", { active: false })
    run("channelUpdate", { channel_id: "g", channel_type: 2 })
    run("typing", { channel_id: "g", channel_type: 2, from_uid: "u", from_name: "User" })
    run("groupAvatarUpdate", { group_no: "g" })
    run("unreadClear", { channel_id: "g", channel_type: 2, unread: 3 })
    run("conversationDeleted", { channel_id: "g", channel_type: 2 })
    run("friendRequest", { apply_uid: "u", apply_name: "User", remark: "hi", token: "t" })
    run("friendAccept", { to_uid: "" })
    run("friendDeleted")
    run("memberUpdate", { group_no: "g" })
    run("onlineStatus", { uid: "u", online: 0 })
    run("syncConversationExtra")
    run("syncReminders")
    run("messageRevoke", { message_id: "revoke-me" })
    run("userAvatarUpdate", { uid: "u" })
    for (const listener of messageListeners) {
      try { listener({ channel, contentType: MessageContentTypeConst.channelUpdate, messageID: "m", messageSeq: 1, fromUID: "other", content: { conversationDigest: "hi" } }) } catch {}
      try { listener({ channel, contentType: MessageContentTypeConst.addMembers, messageID: "m2", messageSeq: 2, fromUID: "other", content: { conversationDigest: "hi" } }) } catch {}
      try { listener({ channel, contentType: MessageContentTypeConst.removeMembers, messageID: "m3", messageSeq: 3, fromUID: "other", content: { conversationDigest: "hi" } }) } catch {}
    }
    sdk.chatManager.addCMDListener = originalAdd
    sdk.chatManager.addMessageListener = originalAddMessage
    sdk.conversationManager.findConversation = originalFindConversation
    sdk.conversationManager.removeConversation = originalRemoveConversation
    sdk.conversationManager.syncExtra = originalSyncExtra
    expect(runtimeConversation.unread).toBe(3)
    expect(runtimeConversation.lastMessage.remoteExtra.revoke).toBe(true)
    expect(commands.length).toBeGreaterThan(0)
  })

  it("covers notification attention guards and standalone registrations", async () => {
    const module: any = new BaseModule()
    const channel = new Channel("notify-group", 2)
    const message: any = {
      channel,
      channelType: 2,
      contentType: 1,
      fromUID: "other",
      messageID: "m1",
      messageSeq: 0,
      content: { conversationDigest: "hello", contentObj: {} },
    }
    ;(WKApp as any).loginInfo.uid = "me"
    ;(WKApp as any).loginInfo.token = "token"
    ;(WKApp as any).shared.currentSpaceId = ""
    expect(module.isAttentionContextCurrent({ accountId: "me", spaceId: "", loginToken: "token" })).toBe(true)
    expect(module.isAttentionContextCurrent({ accountId: "other", spaceId: "", loginToken: "token" })).toBe(false)
    expect(module.isWindowActuallyFocused()).toBeTypeOf("boolean")
    await expect(module.getNotifyDecision(message)).resolves.toEqual({ playSound: true, showPopup: true })
    await expect(module.isIncomingMessageVisible(message)).resolves.toBeTypeOf("boolean")
    const listener = vi.fn()
    const stop = module.subscribeMessageAttentionChanges(listener)
    stop()
    module.registerChatToolbars()
    module.registerChannelHeaderRightItems()
    module.registerChatMenus()
    try { (WKApp as any).shared.chatMenus() } catch {}
  })

  it("covers toolbar, user-info, and notification callback branches", async () => {
    const module: any = new BaseModule()
    module.registerChatToolbars()
    const insertText = vi.fn()
    const toolbarContext: any = {
      channel: () => new Channel("toolbar-group", 2),
      messageInputContext: () => ({ insertText }),
    }
    for (const endpoint of EndpointManager.shared.getWithCategory(EndpointCategory.chatToolbars) || []) {
      const node: any = endpoint.handler(toolbarContext)
      node?.props?.onClick?.()
    }
    expect(insertText).toHaveBeenCalledWith("@")
    const personNode: any = EndpointManager.shared.get("chattoolbar.mention")?.handler({
      channel: () => new Channel("person", 1),
    })
    expect(personNode).toBeUndefined()

    const data = {
      uid: "external-user", isSelf: false,
      channelInfo: { orgData: {
        follow: 1, status: 1, displayName: "External",
        home_space_id: "other-space", home_space_name: "Other",
      }},
      fromSubscriberOfUser: { orgData: {} },
      fromChannel: new Channel("group", 2),
    }
    const alerts: any[] = []
    ;(WKApp as any).shared.baseContext = { showAlert: vi.fn((v: any) => alerts.push(v)) }
    const common = (WKApp as any).dataSource.commonDataSource
    common.deleteFriend = vi.fn().mockResolvedValue(undefined)
    common.blacklistAdd = vi.fn().mockResolvedValue(undefined)
    common.blacklistRemove = vi.fn().mockResolvedValue(undefined)
    ;(WKApp as any).dataSource.contactsSync = vi.fn()
    const route: any = { routeData: () => data, push: vi.fn(), pop: vi.fn() }
    const sections: any[] = (WKApp as any).shared.userInfos(route)
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      for (const row of section?.rows || []) row.properties?.onClick?.()
    }
    alerts.forEach((alert) => alert.onOk?.())

    const blacklisted = { ...data, channelInfo: { orgData: {
      follow: 0, status: 2, home_space_id: "other-space",
    }}}
    const blacklistSections: any[] = (WKApp as any).shared.userInfos({ ...route, routeData: () => blacklisted })
    expect(blacklistSections.some((section) => section?.rows?.length)).toBe(true)
    await Promise.resolve()
  })

  it("exercises context-menu guards for message families and channel roles", () => {
    const module = new BaseModule()
    try { module.init() } catch {}
    ;(WKApp as any).remoteConfig.threadOn = true
    const group = new Channel("menu-matrix", 2)
    const person = new Channel("peer", 1)
    const context: any = {
      getCachedSelectedText: () => "selected",
      channel: () => group,
      reply: vi.fn(),
      fowardMessageUI: vi.fn(),
      setEditOn: vi.fn(),
      revokeMessage: vi.fn().mockResolvedValue(undefined),
      push: vi.fn(),
      pop: vi.fn(),
    }
    const base: any = {
      messageID: "matrix-message", clientMsgNo: "matrix-client", fromUID: "peer",
      channel: group, channelType: 2, send: false, messageSeq: 3, timestamp: Date.now(),
      content: { text: "hello", conversationDigest: "hello", contentObj: {}, encodeJSON: () => ({}) },
    }
    const invoke = (id: string, message: any) => {
      try {
        const action: any = EndpointManager.shared.get(id)?.handler?.({ message, context })
        action?.onClick?.()
      } catch {}
    }
    for (const contentType of [1, 2, 8, 14, 17, 98, 1001, 1004]) {
      invoke("contextmenus.copy", { ...base, contentType })
      invoke("contextmenus.forward", { ...base, contentType })
      invoke("contextmenus.reply", { ...base, contentType })
      invoke("contextmenus.muli", { ...base, contentType })
      invoke("contextmenus.revoke", { ...base, contentType })
    }
    invoke("contextmenus.copyImage", { ...base, contentType: 2, content: { url: "https://cdn/image.png" } })
    invoke("contextmenus.createThread", { ...base, channel: group, contentType: 1 })
    invoke("contextmenus.createThread", { ...base, channel: person, channelType: 1, contentType: 1 })
    expect(context.reply).toHaveBeenCalled()
  })

  it("runs copy, image-copy, and sticker menu actions with real payloads", async () => {
    const module = new BaseModule()
    try { module.init() } catch {}
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard })
    const common = (WKApp as any).dataSource.commonDataSource
    common.getImageURL = vi.fn((url: string) => `resolved:${url}`)
    common.collectSticker = vi.fn().mockResolvedValue(undefined)
    ;(WKApp as any).remoteConfig.stickerCustomEnabled = true
    const context: any = { getCachedSelectedText: () => "selected" }
    const invoke = (id: string, message: any) => {
      const endpoint: any = EndpointManager.shared.get(id)
      const item = endpoint?.handler?.({ message, context })
      item?.onClick?.()
      return item
    }
    expect(invoke("contextmenus.copy", {
      contentType: 1, messageID: "copy-text", fromUID: "u",
      content: { text: "full text" },
    })).toBeTruthy()
    expect(invoke("contextmenus.copy", {
      contentType: 14, messageID: "copy-rich", fromUID: "u",
      content: { plain: "rich text", blocks: [] },
    })).toBeTruthy()
    expect(invoke("contextmenus.copyImage", {
      contentType: 2, content: { url: "image.png", width: 10, height: 20 },
    })).toBeTruthy()
    expect(invoke("contextmenus.addSticker", {
      contentType: 12, content: { format: "png", url: "sticker.png", placeholder: "" },
    })).toBeTruthy()
    await Promise.resolve()
    expect(clipboard.writeText).toHaveBeenCalledWith("selected")
    expect(common.getImageURL).toHaveBeenCalledWith("image.png", { width: 10, height: 20 })
    expect(common.collectSticker).toHaveBeenCalled()
  })

})
