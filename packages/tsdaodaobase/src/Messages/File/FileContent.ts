import { MediaMessageContent } from "wukongimjssdk"
import { MessageContentTypeConst } from "../../Service/Const"

export class FileContent extends MediaMessageContent {
    name!: string
    extension!: string
    size!: number
    url!: string

    constructor(file?: File, name?: string, extension?: string, size?: number) {
        super()
        this.file = file
        this.name = name || ""
        this.extension = extension || ""
        this.size = size || 0
    }

    decodeJSON(content: any) {
        this.name = content["name"] || ""
        this.extension = content["extension"] || ""
        this.size = content["size"] || 0
        this.url = content["url"] || ""
        this.remoteUrl = this.url
    }

    encodeJSON() {
        return {
            "name": this.name || "",
            "extension": this.extension || "",
            "size": this.size || 0,
            "url": this.remoteUrl || "",
        }
    }

    get contentType() {
        return MessageContentTypeConst.file
    }

    get conversationDigest() {
        return "[文件]"
    }
}
