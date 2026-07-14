import { Message, MessageTask } from "wukongimjssdk"

export interface MessageUploadTaskCallbackDeps {
    createMessageUploadTask: (message: Message) => MessageTask
}

export function createMessageUploadTaskCallback(deps: MessageUploadTaskCallbackDeps) {
    return function messageUploadTaskCallback(message: Message): MessageTask {
        return deps.createMessageUploadTask(message)
    }
}
