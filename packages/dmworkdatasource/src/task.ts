import { WKApp } from "@octo/base";
import axios from "axios";
import { MediaMessageContent } from "wukongimjssdk";
import {  MessageTask, TaskStatus } from "wukongimjssdk";

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
            const param = new FormData();
            param.append("file", mediaContent.file);
            const fileName = this.getUUID();
            const path = `/${this.message.channel.channelType}/${this.message.channel.channelID}/${fileName}${mediaContent.extension??""}`
            const uploadURL = await  this.getUploadURL(path)
            if(uploadURL) {
                await this.uploadFile(mediaContent.file,uploadURL)

            }else{
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

   async uploadFile(file:File,uploadURL:string) {
        const param = new FormData();
        param.append("file", file);
        // 动态超时：每 MB 预留 10 秒，最低 2 分钟兜底
        const fileSizeMB = file.size / (1024 * 1024);
        const timeoutMs = Math.max(2 * 60 * 1000, fileSizeMB * 10 * 1000);
        const resp = await axios.post(uploadURL,param,{
            headers: { "Content-Type": "multipart/form-data" },
            signal: (this.controller = new AbortController()).signal,
            timeout: timeoutMs,
            onUploadProgress: e => {
                if (e.total && e.total > 0) {
                    this._progress = Math.round((e.loaded / e.total) * 100);
                    this.update()
                }
            }
        }).catch(error => {
            this.status = TaskStatus.fail
            this.update()
        })
        if(resp) {
            if(resp.data.path) {
                const mediaContent = this.message.content as MediaMessageContent
                mediaContent.remoteUrl = resp.data.path
                this.status = TaskStatus.success
                this.update()
            }
        }
    }

    // 获取上传路径
    async getUploadURL(path:string) :Promise<string|undefined> {
       const result = await WKApp.apiClient.get(`file/upload?path=${encodeURIComponent(path)}&type=chat`)
       if(result) {
           return result.url
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

}