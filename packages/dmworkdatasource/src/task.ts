import { WKApp } from "@octo/base";
import axios from "axios";
import { MediaMessageContent } from "wukongimjssdk";
import {  MessageTask, TaskStatus } from "wukongimjssdk";
import { shouldAttachUploadToken } from "./datasource";

// Isolated axios instance: carries NONE of the global request interceptors.
// The shared `axios` has an interceptor (APIClient) that injects the Octo
// session token into EVERY outgoing request.  The COS pre-signed upload URL
// is a *foreign-origin* endpoint — sending the token there causes COS to
// reject the request with 403/400 (unexpected Authorization header on a
// pre-signed URL).  datasource.ts already guards uploadSticker with the same
// pattern; this instance mirrors that fix for chat-file uploads.
// A finite timeout avoids hanging on an unreachable foreign host.
const noInterceptorAxios = axios.create({ timeout: 10 * 60 * 1000 })  // 10 min ceiling

interface UploadCredentials {
    uploadUrl: string
    downloadUrl: string
    contentType: string
    contentDisposition?: string
    key: string
    expiredTime: number
}

export class MediaMessageUploadTask extends MessageTask {
    private _progress?:number
    private controller: AbortController | undefined
    getUUID(){
        const len=32;//32长度
        const radix=16;//16进制
        const bytes = new Uint8Array(len);
        crypto.getRandomValues(bytes);
        const chars='0123456789ABCDEF'.split('');const uuid:string[]=[]; let i;for(i=0;i<len;i++)uuid[i]=chars[bytes[i] % radix];
        return uuid.join('');
      }

    async start(): Promise<void> {
        const mediaContent = this.message.content as MediaMessageContent
        if(mediaContent.file) {
            try {
                const fileName = this.getUUID();
                const ext = mediaContent.extension ? `.${mediaContent.extension}` : ""
                const path = `/${this.message.channel.channelType}/${this.message.channel.channelID}/${fileName}${ext}`
                const credentials = await this.getUploadCredentials(mediaContent.file, path)
                if(credentials) {
                    await this.uploadFile(mediaContent.file, credentials)
                }else{
                    this.status = TaskStatus.fail
                    this.update()
                }
            } catch {
                this.status = TaskStatus.fail
                this.update()
            }
        }else {
            if (mediaContent.remoteUrl && mediaContent.remoteUrl !== "") {
                this.status = TaskStatus.success
                this.update()
            } else {
                this.status = TaskStatus.fail
                this.update()
            }
        }
    }

    async uploadFile(file: File, credentials: UploadCredentials) {
        // Dynamic timeout: 10 s/MB, minimum 2 min, so a 40 MB file gets ~6 min 40 s.
        const fileSizeMB = file.size / (1024 * 1024);
        const timeoutMs = Math.max(2 * 60 * 1000, fileSizeMB * 10 * 1000);
        const headers: Record<string, string> = { "Content-Type": credentials.contentType }
        if (credentials.contentDisposition) {
            headers["Content-Disposition"] = credentials.contentDisposition
        }
        // Use the isolated axios instance (no token injected) when the upload
        // target is a foreign origin (e.g. COS pre-signed URL).  Sending the
        // Octo session token to a third-party host causes 403/400 rejections
        // because COS treats any unexpected Authorization/token header on a
        // pre-signed URL as a conflict.  Mirror the same origin-check used by
        // datasource.ts uploadSticker.
        const locationHref = typeof window !== "undefined" ? window.location.href : ""
        const apiBaseURL = WKApp.apiClient.config.apiURL
        // Mirror datasource.ts uploadSticker exactly: !!locationHref && shouldAttachUploadToken.
        // When locationHref is empty (non-browser / origin undetermined), default to
        // noInterceptorAxios (fail-closed: withhold the token rather than leak it).
        const useSameOriginAxios = !!locationHref &&
            shouldAttachUploadToken(credentials.uploadUrl, apiBaseURL, locationHref)
        const client = useSameOriginAxios ? axios : noInterceptorAxios
        const resp = await client.put(credentials.uploadUrl, file, {
            headers,
            signal: (this.controller = new AbortController()).signal,
            timeout: timeoutMs,
            onUploadProgress: e => {
                if (e.total && e.total > 0) {
                    this._progress = Math.round((e.loaded / e.total) * 100);
                    this.update()
                }
            }
        }).catch(() => {
            // Don't overwrite cancel status — abort triggers catch too
            if (this.status !== TaskStatus.cancel) {
                this.status = TaskStatus.fail
                this.update()
            }
        })
        if(resp && resp.status >= 200 && resp.status < 300) {
            const mediaContent = this.message.content as MediaMessageContent
            mediaContent.url = credentials.downloadUrl
            mediaContent.remoteUrl = credentials.downloadUrl
            this.status = TaskStatus.success
            this.update()
        } else if(resp) {
            this.status = TaskStatus.fail
            this.update()
        }
    }

    // 获取预签名直传凭证（COS 直传）
    async getUploadCredentials(file: File, path: string): Promise<UploadCredentials | undefined> {
        const contentType = file.type || "application/octet-stream"
        const fileName = file.name || 'file'
        const fileSize = file.size
        const result = await WKApp.apiClient.get(
            `file/upload/credentials?path=${encodeURIComponent(path)}&type=chat&filename=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(contentType)}&fileSize=${fileSize}`
        )
        if(result && result.uploadUrl && result.downloadUrl) {
            return result as UploadCredentials
        }
    }

    suspend(): void {
    }
    resume(): void {
       
    }
    cancel(): void {
        this.status = TaskStatus.cancel
        if(this.controller) {
            this.controller.abort()
        }
        this.update()
    }
    /** 返回上传进度整数百分比（0~100） */
    progress(): number {
        return this._progress ?? 0
    }

    /**
     * 重试上传：防重入 + 取消上一个请求，再重置状态重新 start()。
     * Note: expiredTime is not checked here because start() always re-fetches
     * fresh credentials via getUploadCredentials, so stale tokens are never reused.
     */
    async restart(): Promise<void> {
        if (this.status === TaskStatus.processing) return // 防重入
        this.controller?.abort() // 取消上一个请求（如有）
        this.status = TaskStatus.processing
        this._progress = 0
        this.update()
        await this.start()
    }

}
