import { Channel } from "wukongimjssdk"
import APIClient, { extractErrorMsg } from "./APIClient"

/**
 * 上传前预检 file/upload/credentials。
 *
 * Why: GH Mininglamp-OSS/octo-web#119 — 后端会对文件类型/大小做白名单校验
 * (例如 .xlsm 会返回 `400 不支持的文件类型`)。SDK 层 `MediaMessageUploadTask`
 * 把 credentials 调用放在 `chatManager.send` 之后,而 `send` 已经把消息气泡
 * 塞进了本地会话队列;失败也只是把 task 状态翻成 fail、错误信息整个吞掉,
 * 用户看到一条假的"已发送"气泡且没有任何提示,刷新后消息消失。
 *
 * How: 在 UI 调用 `vm.sendMessage` *之前* 先打一次 credentials,失败就 Toast
 * 后端 msg 并 return,气泡完全不进聊天框。成功路径会多调一次 credentials
 * (task 内部仍会再 fetch 一次新凭证),credentials 接口轻量,可接受。
 *
 * 失败时抛出的 Error 上挂 `.msg` 字段,UI 层可直接读取无需再次解析。
 */
export async function precheckUploadCredentials(
    file: File,
    channel: Channel,
    extension: string,
): Promise<void> {
    const contentType = file.type || "application/octet-stream"
    const fileName = file.name || "file"
    const fileSize = file.size
    const ext = extension ? `.${extension}` : ""
    const path = `/${channel.channelType}/${channel.channelID}/${genUploadUUID()}${ext}`

    let result: { uploadUrl?: unknown; downloadUrl?: unknown } | undefined
    try {
        result = await APIClient.shared.get(
            `file/upload/credentials?path=${encodeURIComponent(path)}&type=chat&filename=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(contentType)}&fileSize=${fileSize}`,
        )
    } catch (err) {
        const msg =
            extractErrorMsg(err) ||
            (err instanceof Error ? err.message : "") ||
            "上传失败"
        throwWithMsg(msg)
    }

    // 200 但响应缺字段时单独抛, 不要再被一个 catch 吞掉重写 (#135 review by lml2468)。
    if (!result || typeof result.uploadUrl !== "string" || typeof result.downloadUrl !== "string") {
        throwWithMsg("响应缺少凭证字段")
    }
}

function throwWithMsg(msg: string): never {
    const e = new Error(msg) as Error & { msg: string }
    e.msg = msg
    throw e
}

function genUploadUUID(): string {
    const len = 32
    const radix = 16
    const bytes = new Uint8Array(len)
    crypto.getRandomValues(bytes)
    const chars = "0123456789ABCDEF".split("")
    const uuid: string[] = []
    for (let i = 0; i < len; i++) uuid[i] = chars[bytes[i] % radix]
    return uuid.join("")
}
