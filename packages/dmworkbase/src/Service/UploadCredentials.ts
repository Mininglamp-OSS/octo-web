import { Channel } from "wukongimjssdk"
import axios from "axios"
import APIClient, { extractErrorMsg } from "./APIClient"
import { t } from "../i18n"

// Isolated axios instance — carries NONE of the global request interceptors.
// The shared axios has a request interceptor (APIClient.initAxios) that injects
// the Octo session token into every outgoing request.  COS pre-signed upload
// URLs are foreign-origin; sending the token there causes 403/400 (unexpected
// header conflicts with the pre-signed signature).  This mirrors the pattern
// used in packages/dmworkdatasource/src/task.ts and datasource.ts (uploadSticker).
const noInterceptorAxios = axios.create({ timeout: 10 * 60 * 1000 }) // 10 min ceiling

/**
 * Return true iff uploadURL should receive the Octo session token, i.e. it
 * shares its origin with the API base URL or the document origin.
 * Inlined from dmworkdatasource/src/datasource.ts to avoid a cross-package
 * import (dmworkbase does not depend on dmworkdatasource).
 */
function shouldAttachToken(uploadURL: string, apiBaseURL: string): boolean {
    try {
        const locationHref = typeof window !== "undefined" ? window.location.href : ""
        // Mirror datasource.ts: when origin is undetermined, default fail-closed
        // (withhold the token) rather than fail-open (leak it to a foreign host).
        if (!locationHref) return false
        const docOrigin = new URL(locationHref).origin
        const apiOrigin = new URL(apiBaseURL || locationHref, locationHref).origin
        const target = new URL(uploadURL, locationHref).origin
        return target === apiOrigin || target === docOrigin
    } catch {
        return false // URL-parse failure: fail-closed, withhold token
    }
}

interface UploadCredentials {
    uploadUrl: string
    downloadUrl: string
    contentType: string
    contentDisposition?: string
}

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
            t("base.uploadCredentials.failed")
        throwWithMsg(msg)
    }

    // 200 但响应缺字段时单独抛, 不要再被一个 catch 吞掉重写 (#135 review by lml2468)。
    if (!result || typeof result.uploadUrl !== "string" || typeof result.downloadUrl !== "string") {
        throwWithMsg(t("base.uploadCredentials.missingFields"))
    }
}

function throwWithMsg(msg: string): never {
    const e = new Error(msg) as Error & { msg: string }
    e.msg = msg
    throw e
}

/**
 * 上传一个聊天文件并返回最终 downloadUrl。
 *
 * Why: 图文混排 RichText(=14) 发送侧需要在「构造单条 payload」之前先把每张图片
 * 上传拿到 url（与逐条 ImageContent 发送不同——后者由 SDK MediaMessageUploadTask
 * 在发送时上传）。直接复用 SDK 的 task 拿不到 url 再聚合，故抽出独立直传。
 *
 * How: 与 `dmworkdatasource` 的 `MediaMessageUploadTask` 完全同一套两步：
 *   1. GET file/upload/credentials（同一接口、同一 query 形状）拿预签名直传凭证；
 *   2. axios.put(uploadUrl, file) 直传，成功返回 downloadUrl。
 *
 * 失败抛出的 Error 上挂 `.msg`，UI 层可直接 Toast，无需再解析。
 */
export async function uploadChatMedia(
    file: File,
    channel: Channel,
    extension: string,
): Promise<string> {
    const contentType = file.type || "application/octet-stream"
    const fileName = file.name || "file"
    const fileSize = file.size
    const ext = extension ? `.${extension}` : ""
    const path = `/${channel.channelType}/${channel.channelID}/${genUploadUUID()}${ext}`

    let credentials: UploadCredentials | undefined
    try {
        credentials = await APIClient.shared.get<UploadCredentials>(
            `file/upload/credentials?path=${encodeURIComponent(path)}&type=chat&filename=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(contentType)}&fileSize=${fileSize}`,
        )
    } catch (err) {
        const msg =
            extractErrorMsg(err) ||
            (err instanceof Error ? err.message : "") ||
            t("base.uploadCredentials.failed")
        throwWithMsg(msg)
    }

    if (!credentials || typeof credentials.uploadUrl !== "string" || typeof credentials.downloadUrl !== "string") {
        throwWithMsg(t("base.uploadCredentials.missingFields"))
    }

    // 动态超时：每 MB 预留 10 秒，最低 2 分钟兜底（对齐 MediaMessageUploadTask）。
    const fileSizeMB = file.size / (1024 * 1024)
    const timeoutMs = Math.max(2 * 60 * 1000, fileSizeMB * 10 * 1000)
    const headers: Record<string, string> = { "Content-Type": credentials.contentType }
    if (credentials.contentDisposition) {
        headers["Content-Disposition"] = credentials.contentDisposition
    }

    // Use the isolated axios instance (no token injected) when the upload target
    // is a foreign origin (e.g. COS pre-signed URL).  Mirrors task.ts / datasource.ts.
    const apiBaseURL = APIClient.shared.config.apiURL
    const client = shouldAttachToken(credentials.uploadUrl, apiBaseURL) ? axios : noInterceptorAxios

    try {
        const resp = await client.put(credentials.uploadUrl, file, { headers, timeout: timeoutMs })
        if (!(resp.status >= 200 && resp.status < 300)) {
            throwWithMsg(t("base.conversation.upload.failed"))
        }
    } catch (err) {
        if (err && typeof err === "object" && "msg" in err) throw err
        const msg = (err instanceof Error ? err.message : "") || t("base.conversation.upload.failed")
        throwWithMsg(msg)
    }

    return credentials.downloadUrl
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
