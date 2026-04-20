import { WKApp } from "@octo/base";
import axios from "axios";
import { MediaMessageContent } from "wukongimjssdk";
import {  MessageTask, TaskStatus } from "wukongimjssdk";

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
                const path = `/${this.message.channel.channelType}/${this.message.channel.channelID}/${fileName}${mediaContent.extension ?? ""}`
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
        // 动态超时：每 MB 预留 10 秒，最低 2 分钟兜底
        const fileSizeMB = file.size / (1024 * 1024);
        const timeoutMs = Math.max(2 * 60 * 1000, fileSizeMB * 10 * 1000);
        const headers: Record<string, string> = { "Content-Type": credentials.contentType }
        if (credentials.contentDisposition) {
            headers["Content-Disposition"] = credentials.contentDisposition
        }
        const resp = await axios.put(credentials.uploadUrl, file, {
            headers,
            signal: (this.controller = new AbortController()).signal,
            timeout: timeoutMs,
            onUploadProgress: e => {
                if (e.total && e.total > 0) {
                    this._progress = Math.round((e.loaded / e.total) * 100);
                    this.update()
                }
            }
        }).catch(error => {
            // Don't overwrite cancel/restart status — abort triggers catch too
            if (this.status !== TaskStatus.cancel && this.status !== TaskStatus.processing) {
                this.status = TaskStatus.fail
                this.update()
            }
        })
        if(resp && resp.status >= 200 && resp.status < 300) {
            const mediaContent = this.message.content as MediaMessageContent
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
        const result = await WKApp.apiClient.get(
            `file/upload/credentials?path=${encodeURIComponent(path)}&type=chat&filename=${encodeURIComponent(fileName)}&contentType=${encodeURIComponent(contentType)}`
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
