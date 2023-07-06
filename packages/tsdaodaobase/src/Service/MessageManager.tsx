import { MessageContentType } from "wukongimjssdk/lib/sdk"
import { ElementType } from "react"


export default class MessageManager {
    cellHandlerMap: Map<number, () => ElementType> = new Map()
    private messageCellFactor?: (contentType: number) => ElementType | undefined
    // 注册cell
    registerCell(contentType: number, handler: () => ElementType) {
        this.cellHandlerMap.set(contentType, handler)
    }
    registerMessageFactor(messageCellFactor: (contentType: number) => ElementType | undefined) {
        this.messageCellFactor = messageCellFactor
    }
    // 获取cell
    getCell(contentType: number) {
        const handler = this.cellHandlerMap.get(contentType)
        if (handler) {
            return handler()
        }
        if (this.messageCellFactor) {
            const cell = this.messageCellFactor(contentType)
            if (cell) {
                return cell
            }
        }

        const unknownHandler = this.cellHandlerMap.get(MessageContentType.unknown)
        if (unknownHandler) {
            return unknownHandler()
        }
    }
}