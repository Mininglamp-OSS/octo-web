import axios, { AxiosResponse } from "axios";
import { buildAcceptLanguage } from "./apiLanguage";
import { isAuthExpiredApiError, normalizeApiError, NormalizedApiError } from "./apiError";

export interface APIClientRejectedError {
    error: unknown;
    msg: string;
    status?: number;
    code?: string;
    details?: Record<string, unknown>;
    backendMessage?: string;
    normalized: NormalizedApiError;
}


/**
 * 从 APIClient 拦截器 reject 的错误对象中提取 msg 字段。
 * 拦截器 reject 形状：{ error, msg: string, status }
 */
export function extractErrorMsg(err: unknown): string {
    if (err && typeof err === "object" && "msg" in err) {
        const msg = (err as { msg: unknown }).msg;
        if (typeof msg === "string") return msg;
    }
    return "";
}

export class APIClientConfig {
    private _apiURL: string =""
    private _token:string = ""
    tokenCallback?:()=>string|undefined
    /**
     * 返回当前 space_id 的回调。
     * 当返回非空字符串时，APIClient 会在每次请求自动注入 `X-Space-Id` header。
     * 通过回调注入（而非直接 import WKApp）是为了避免 APIClient ↔ App 循环依赖。
     * GH Mininglamp-OSS/octo-web#1038
     */
    spaceIdCallback?:()=>string|undefined
    // private _apiURL: string = "/api/v1/" // 正式打包用此地址


    set apiURL(apiURL:string) {
        this._apiURL = apiURL;
        axios.defaults.baseURL = apiURL;
    }
    get apiURL():string {
        return this._apiURL
    }
}

/**
 * 默认请求超时（毫秒）。
 *
 * 在此之前 axios 没有任何超时配置 —— 一旦后端/网关迟迟不返回（连接 hang、
 * 网关 504 前的长挂起、移动弱网），`user/login`、`user/loginuuid`、`space/my`
 * 这些请求的 Promise 永远不 settle，于是 LoginVM.loginLoading 一直停在 true，
 * 登录按钮 / 二维码就「一直转圈」无法恢复（YUJ-2628）。
 *
 * 给一个全局兜底超时，请求超时后会被 response 拦截器 normalizeApiError 归类成
 * 可读 msg 并 reject，前端的 .catch / finally 才能复位 loading 状态并提示重试。
 * 文件上传等长耗时请求走的是直接的 `axios.post/put`（带各自的 timeout），
 * 不经过这里的 get/post/put/delete 封装，所以不受影响。
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

export default class APIClient {
    private constructor() {
        this.initAxios()
    }
    public static shared = new APIClient()
    public config = new APIClientConfig()
    public logoutCallback?:()=>void

    initAxios() {
        const self = this
        // 全局默认超时兜底，避免请求永久挂起导致登录页一直转圈（YUJ-2628）。
        // 单个请求仍可通过 config.timeout 覆盖（如上传走更长的超时）。
        axios.defaults.timeout = DEFAULT_REQUEST_TIMEOUT_MS
        axios.interceptors.request.use(function (config) {
            config.headers = config.headers || {};
            config.headers["Accept-Language"] = buildAcceptLanguage();
            let token:string | undefined
            if(self.config.tokenCallback) {
                token = self.config.tokenCallback()
            }
            if (token && token !== "") {
                config.headers!["token"] = token;
            }
            // 统一注入 X-Space-Id header（GH Mininglamp-OSS/octo-web#1038）。
            // 仅当回调返回非空字符串时写入，避免把 "" 作为合法 space_id 传给后端。
            // 与 URL query 里的 space_id= 拼接共存，后端按优先级双读，前端渐进迁移。
            // 合并策略：per-request 显式头优先。若调用方已通过 config.headers 显式带上
            // X-Space-Id（如 standalone /d/:docId 冷启动 preflight），拦截器不覆盖它；
            // 仅在显式头缺省时用 currentSpaceId 兜底注入。这样显式头与拦截器头永远一致
            // （显式为准/拦截器兜底），不会互相冲突。
            if (self.config.spaceIdCallback && !config.headers!["X-Space-Id"]) {
                const spaceId = self.config.spaceIdCallback()
                if (spaceId && spaceId !== "") {
                    config.headers!["X-Space-Id"] = spaceId;
                }
            }
            return config;
        });

        axios.interceptors.response.use(function (response) {
            return response;
        }, function (error) {
            const normalized = normalizeApiError({
                data: error?.response?.data,
                httpStatus: error?.response?.status,
                raw: error,
            });
            if (isAuthExpiredApiError(normalized) && self.logoutCallback) {
                self.logoutCallback()
            }
            const rejected: APIClientRejectedError = {
                error: error,
                msg: normalized.message,
                status: normalized.httpStatus,
                code: normalized.code,
                details: normalized.details,
                backendMessage: normalized.backendMessage,
                normalized,
            };
            return Promise.reject(rejected);
        });
    }

     get<T>(path: string, config?: RequestConfig) {
       return this.wrapResult<T>(axios.get(path, {
        params: config?.param,
        headers: config?.headers,
        responseType: config?.responseType,
        timeout: config?.timeout,
    }), config)
    }
    post(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.post(path, data, {
            headers: config?.headers,
            responseType: config?.responseType,
            timeout: config?.timeout,
        }), config)
    }

    put(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.put(path, data, {
            params: config?.param,
            headers: config?.headers,
        }), config)
    }

    patch(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.patch(path, data, {
            params: config?.param,
            headers: config?.headers,
        }), config)
    }

    delete(path: string, config?: RequestConfig) {
        return this.wrapResult(axios.delete(path, {
            params: config?.param,
            data: config?.data,
            headers: config?.headers,
        }), config)
    }

    private async wrapResult<T = APIResp>(result: Promise<AxiosResponse>, config?: RequestConfig): Promise<T|any> {
        if (!result) {
            return Promise.reject(new Error("Invalid request: result is null or undefined"))
        }
        
        return  result.then((value) => {
          
            if (!config || !config.resp) {
                
                return Promise.resolve(value.data)
            }
            if (value.data) {
                const results = new Array<T>()
                if (value.data instanceof Array) {
                    for (const data of value.data) {
                        const resp = config.resp()
                        resp.fill(data)
                        results.push(resp as unknown as T)
                    }
                    return results
                } else {
                    const sresp = config.resp()
                    sresp.fill(value.data)
                    return Promise.resolve(sresp)
                }
            }
            return Promise.resolve()
        })
    }
}

export class RequestConfig {
    param?: any
    data?:any
    resp?: () => APIResp
    /**
     * 逐请求显式 HTTP 头，转发给 axios 并由其合并进最终请求头。用于让 per-request 头
     * （如 standalone /d/:docId preflight 的 X-Space-Id）真正上 wire。合并策略见
     * initAxios 的请求拦截器：显式头优先，拦截器仅在对应头缺省时兜底注入。不传则完全
     * 保持既有无显式头行为。
     */
    headers?: Record<string, string>
    /**
     * Per-request axios responseType passthrough. Defaults to axios' `'json'`.
     * `'arraybuffer'` is required for binary endpoints (e.g. server-side PDF
     * export) so the response body is not decoded as UTF-8 text — every
     * non-ASCII byte would otherwise become U+FFFD and corrupt the file.
     */
    responseType?: 'json' | 'arraybuffer' | 'blob' | 'text'
    /**
     * Per-request timeout in ms, overriding the shared 20s default. Long
     * server-side renders (large document export) need a higher ceiling.
     */
    timeout?: number
}

export interface APIResp {

    fill(data: any): void;
}
