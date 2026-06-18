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
            if (self.config.spaceIdCallback) {
                const spaceId = self.config.spaceIdCallback()
                if (spaceId && spaceId !== "") {
                    config.headers!["X-Space-Id"] = spaceId;
                }
            }
            // 合并 plan 决策一+二 Phase 3A: fleet/matter 已切到 AuthMiddleware,
            // 接受 token: <session> 跟 server 一致, 不再换 JWT。删 getFleetJWT
            // + FLEET_URL_RE 后 interceptor 走单一 session token 路径。
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
        baseURL: config?.baseURL,
    }), config)
    }
    post(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.post(path, data, {
            baseURL: config?.baseURL,
        }), config)
    }

    put(path: string, data?: any, config?: RequestConfig) {
        return this.wrapResult(axios.put(path, data, {
            params: config?.param,
            baseURL: config?.baseURL,
        }), config)
    }

    delete(path: string, config?: RequestConfig) {
        return this.wrapResult(axios.delete(path, {
            params: config?.param,
            data: config?.data,
            baseURL: config?.baseURL,
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
     * 逐请求覆盖 axios 全局 baseURL。用于走独立挂载段的后端服务
     * (如 fleet 经 nginx 的 /fleet/api 段挂载),而无需污染全局 baseURL
     * 或新建一套 client。不传则沿用 axios.defaults.baseURL。
     */
    baseURL?: string
}

export interface APIResp {

    fill(data: any): void;
}
