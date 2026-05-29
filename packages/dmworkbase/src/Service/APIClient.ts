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

export default class APIClient {
    private constructor() {
        this.initAxios()
    }
    public static shared = new APIClient()
    public config = new APIClientConfig()
    public logoutCallback?:()=>void

    initAxios() {
        const self = this
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
            if (self.config.spaceIdCallback) {
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
        params: config?.param
    }), config)
    }
    post(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.post(path, data, {}), config)
    }

    put(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.put(path, data, {
            params: config?.param,
        }), config)
    }

    delete(path: string, config?: RequestConfig) {
        return this.wrapResult(axios.delete(path, {
            params: config?.param,
            data: config?.data,
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
}

export interface APIResp {

    fill(data: any): void;
}
