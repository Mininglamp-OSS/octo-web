import { Channel, Message } from "wukongimjssdk";
import WKApp from "../App";
import { TypingContent } from "../Messages/Typing";

export type TypingListener = (channel: Channel, add: boolean) => void

export class TypingManager {
    private typingMap: Map<string, Typing> = new Map()
    private typingListeners: TypingListener[] = new Array<TypingListener>();

    private constructor() {
    }
    public static shared = new TypingManager()

  

    addTyping(channel: Channel, fromUID: string, fromName: string) {
        if(fromUID === WKApp.loginInfo.uid) {
            return
        }
        const typing = this.typingMap.get(channel.getChannelKey())
        if (typing) {
            typing.restart()
        } else {
            const newTyping = new Typing(fromUID, fromName, () => {
                this.removeTyping(channel)
            })
            this.typingMap.set(channel.getChannelKey(), newTyping)
            newTyping.start()

            this.notifyTypingListener(channel, true)
        }
    }
    // 获取输入中的消息（仿造）
    getFakeTypingMessage(channel: Channel) {
        const typing = this.typingMap.get(channel.getChannelKey())
        if (!typing) {
            return
        }
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
        return this.typingMap.get(channel.getChannelKey())
    }
    removeTyping(channel: Channel) {
        const typing = this.typingMap.get(channel.getChannelKey())
        if (typing) {
            typing.stop()
        }
        this.typingMap.delete(channel.getChannelKey())
        this.notifyTypingListener(channel, false)
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