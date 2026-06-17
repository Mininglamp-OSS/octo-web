import axios from "axios";
import { WKApp, buildAcceptLanguage } from "@octo/base";

// 候选会话（群/子区）搜索使用独立的 axios 实例：
// 该接口走 /summary/api/v1 网关，与 WKApp.apiClient（IM API /v1/）不同，
// 不能复用 apiClient。这里完整复刻 summary 模块原本的 HTTP 行为（同样的
// header、base path、401 处理与 envelope 解包），使转发选择器（ForwardModal）
// 不再隐式依赖 summary 模块。
const candidatesAxios = axios.create({ baseURL: "" });

candidatesAxios.interceptors.request.use((config) => {
    config.headers = config.headers ?? {};
    config.headers["Accept-Language"] = buildAcceptLanguage();
    const token = WKApp.loginInfo.token;
    if (token) {
        config.headers["token"] = token;
    }
    const spaceId = WKApp.shared.currentSpaceId;
    if (spaceId) {
        config.headers["X-Space-Id"] = spaceId;
    }
    return config;
});

candidatesAxios.interceptors.response.use(
    (resp) => resp,
    (err) => {
        if (err?.response?.status === 401) {
            WKApp.shared.logout();
        }
        return Promise.reject(err);
    },
);

const BASE = "/summary/api/v1";

// Backend wraps responses in {code, message, data} envelope — unwrap .data
export async function getChatCandidates(params?: {
    keyword?: string;
    chat_type?: string;
    space_id?: string;
}): Promise<any[]> {
    const resp = await candidatesAxios.get(`${BASE}/summary-chat-candidates`, { params });
    const data = resp.data?.data ?? resp.data;
    return data || [];
}
