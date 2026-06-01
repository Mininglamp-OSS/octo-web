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

    // PR-A.2: per-process JWT cache for fleet routes. Acquired on demand
    // by exchanging the session token at POST /v1/auth/token. We use raw
    // fetch (not axios) for that exchange to avoid recursing through our
    // own request interceptor.
    private _jwt: { token: string; expiresAt: number } | null = null

    private static FLEET_URL_RE = /\/runtimes(\/|$|\?)|\/daemon(\/|$|\?)/

    /**
     * Returns a daemon-or-web-scope JWT acceptable to octo-fleet. Cached
     * in-memory; refreshed when within 60s of expiry. Returns "" if no
     * session token is configured (caller should let the request 401).
     */
    private async getFleetJWT(): Promise<string> {
        if (this._jwt && this._jwt.expiresAt > Date.now() + 60_000) {
            return this._jwt.token
        }
        const sessionToken = this.config.tokenCallback?.()
        if (!sessionToken) return ""
        const spaceId = this.config.spaceIdCallback?.() || ""
        try {
            const res = await fetch("/api/v1/auth/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_token: sessionToken, space_id: spaceId }),
            })
            if (!res.ok) {
                // Don't cache failure — next call retries.
                return ""
            }
            const j = await res.json()
            const tok = j?.token || j?.data?.token
            const expiresIn = j?.expires_in || j?.data?.expires_in || 1800
            if (!tok) return ""
            this._jwt = { token: tok, expiresAt: Date.now() + Number(expiresIn) * 1000 }
            return tok
        } catch {
            return ""
        }
    }

    initAxios() {
        const self = this
        // 全局默认超时兜底，避免请求永久挂起导致登录页一直转圈（YUJ-2628）。
        // 单个请求仍可通过 config.timeout 覆盖（如上传走更长的超时）。
        axios.defaults.timeout = DEFAULT_REQUEST_TIMEOUT_MS
        axios.interceptors.request.use(async function (config) {
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
            // PR-A.2: fleet endpoints (under /runtimes or /daemon) require
            // a server-issued JWT in Authorization. Keep the existing
            // `token` header too — server's session AuthMiddleware ignores
            // Authorization and JWT middleware ignores `token`, so the
            // dual-header request works against either backend.
            const url = config.url || ""
            const baseURL = config.baseURL || ""
            const fullPath = url.startsWith("http") ? url : baseURL + url
            if (APIClient.FLEET_URL_RE.test(fullPath)) {
                const jwt = await self.getFleetJWT()
                if (jwt) {
                    config.headers!["Authorization"] = "Bearer " + jwt
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
