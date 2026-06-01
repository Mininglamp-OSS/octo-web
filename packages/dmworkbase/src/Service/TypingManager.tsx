import { Channel, Message } from "wukongimjssdk";
import WKApp from "../App";
import { TypingContent } from "../Messages/Typing";

export type TypingListener = (channel: Channel, add: boolean) => void

interface TypingEntry {
    typing: Typing
    channel: Channel
}

export class TypingManager {
    // value 存 { typing, channel }，以便 resetAll 能反查 Channel 广播 notify
    private typingMap: Map<string, TypingEntry> = new Map()
    private typingListeners: TypingListener[] = new Array<TypingListener>();

    private constructor() {
    }
    public static shared = new TypingManager()



    addTyping(channel: Channel, fromUID: string, fromName: string) {
        if(fromUID === WKApp.loginInfo.uid) {
            return
        }
        const entry = this.typingMap.get(channel.getChannelKey())
        if (entry) {
            entry.typing.restart()
        } else {
            const newTyping = new Typing(fromUID, fromName, () => {
                this.removeTyping(channel)
            })
            this.typingMap.set(channel.getChannelKey(), { typing: newTyping, channel })
            newTyping.start()

            this.notifyTypingListener(channel, true)
        }
    }
    // 获取输入中的消息（仿造）
    getFakeTypingMessage(channel: Channel) {
        const entry = this.typingMap.get(channel.getChannelKey())
        if (!entry) {
            return
        }
        const { typing } = entry
        const message = new Message()
        message.channel = channel
        message.timestamp = new Date().getTime() / 1000
        message.fromUID = typing.fromUID
        message.content = new TypingContent(typing.fromUID, typing.fromName)
        message.clientMsgNo = typing.fromUID
        return message
    }
    hasTyping(channel: Channel): boolean {
        return this.typingMap.has(channel.getChannelKey())
    }
    getTyping(channel: Channel): Typing | undefined {
        return this.typingMap.get(channel.getChannelKey())?.typing
    }
    removeTyping(channel: Channel) {
        const entry = this.typingMap.get(channel.getChannelKey())
        if (entry) {
            entry.typing.stop()
        }
        this.typingMap.delete(channel.getChannelKey())
        this.notifyTypingListener(channel, false)
    }

    // 清除所有会话的 typing：回前台 / 重连后调用，对齐 iOS appDidBecomeActive
    // 与 Connected 两层防御。先快照 channel 列表再 clear，避免遍历中修改 map。
    resetAll() {
        if (this.typingMap.size === 0) {
            return
        }
        const channels: Channel[] = []
        this.typingMap.forEach((entry) => {
            entry.typing.stop()
            channels.push(entry.channel)
        })
        this.typingMap.clear()
        // 聚合 notify：clear 已完成，逐个通知对应会话清除 typing
        channels.forEach((channel) => {
            this.notifyTypingListener(channel, false)
        })
    }

    addTypingListener(listener: TypingListener) {
        this.typingListeners.push(listener)
    }

    removeTypingListener(listener: TypingListener) {
        const len = this.typingListeners.length;
        for (let i = 0; i < len; i++) {
            if (listener === this.typingListeners[i]) {
                this.typingListeners.splice(i, 1)
                return;
            }
        }
    }

    private notifyTypingListener(channel: Channel, add: boolean) {
        if (this.typingListeners) {
            this.typingListeners.forEach((listener) => {
                listener(channel, add);
            });
        }
    }
}

export class Typing {
    timeout: NodeJS.Timeout | undefined;
    timeoutFnc: () => void
    fromUID: string // 输入者的uid
    fromName: string

    constructor(fromUID: string, fromName: string, timeoutFnc: () => void) {
        this.fromUID = fromUID
        this.fromName = fromName
        this.timeoutFnc = timeoutFnc

    }

    start() {
        this.timeout = setTimeout(() => {
            this.timeoutFnc()
        }, 8 * 1000)
    }

    restart() {
        this.stop()
        this.start()
    }
    stop() {
        if (this.timeout) {
            clearTimeout(this.timeout)
            this.timeout = undefined
        }
    }
}