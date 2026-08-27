import axios, { AxiosRequestConfig } from 'axios';
import { WKApp, buildAcceptLanguage, Dap, convertMarkdownToDoc } from '@octo/base';
import type {
    AgentChatHistory,
    AgentChatParams,
    AgentChatResult,
    ApiResponse,
    BatchStatusItem,
    BatchStatusResponse,
    ChatCandidate,
    CreateSummaryParams,
    CreateAgentSummaryParams,
    CreateAgentSummaryResult,
    CreateScheduleParams,
    CustomTopicTemplatePayload,
    InferResult,
    ListSummariesParams,
    ListSummariesResponse,
    MemberCandidate,
    MemberStatus,
    Participant,
    PersonalResult,
    ScheduleItem,
    SourceItem,
    CitationItem,
    SummaryDetail,
    SummaryTemplate,
    SummaryVersionDetail,
    SummaryVersionItem,
    TopicTemplate,
    TopicTemplatesResponse,
    UpdateScheduleParams,
    AgentProgressEvent,
    AgentDoneEvent,
    AgentErrorEvent,
    AgentStreamHandlers,
    CreateSummarySharesResponse,
    GetSummaryShareResponse,
} from '../types/summary';
import { SummaryMode } from '../types/summary';

const summaryAxios = axios.create({ baseURL: '' });

// The summary service is mounted at <origin>/summary/api/v1 (nginx proxies it).
// On Web, apiClient.apiURL is relative ("/api/v1/"), so same-origin requests
// resolve correctly with an empty baseURL. In the browser extension (and
// Electron) the page origin is chrome-extension://… / app://…, so a relative
// "/summary/api/v1/…" request never reaches the backend; derive the API origin
// from apiClient.config.apiURL in those runtimes. GH #420.
function resolveSummaryBaseURL(): string {
    const apiURL = WKApp.apiClient?.config?.apiURL;
    if (!apiURL) return '';
    try {
        return new URL(apiURL).origin;
    } catch {
        // Relative apiURL (Web) has no parsable origin → stay same-origin.
        return '';
    }
}

summaryAxios.interceptors.request.use((config) => {
    config.baseURL = resolveSummaryBaseURL();
    config.headers = config.headers ?? {};
    config.headers['Accept-Language'] = buildAcceptLanguage();
    const token = WKApp.loginInfo.token;
    if (token) {
        config.headers['token'] = token;
    }
    const spaceId = WKApp.shared.currentSpaceId;
    const hasExplicitSpace = Object.keys(config.headers).some(
        (name) => name.toLowerCase() === 'x-space-id',
    );
    if (spaceId && !hasExplicitSpace) {
        config.headers['X-Space-Id'] = spaceId;
    }
    return config;
});

summaryAxios.interceptors.response.use(
    (resp) => resp,
    (err) => {
        if (err?.response?.status === 401) {
            WKApp.shared.logout();
        }
        return Promise.reject(err);
    },
);

const BASE = '/summary/api/v1';

function extractErrorMessage(err: unknown): string {
    const axiosErr = err as { response?: { status?: number; data?: { message?: string; msg?: string; error?: { message?: string } } } };
    const status = axiosErr?.response?.status;
    const data = axiosErr?.response?.data;
    const msg = data?.message || data?.msg || data?.error?.message;
    let raw = msg || (err instanceof Error ? err.message : 'Request failed');
    if (status === 404 && raw.toLowerCase().includes('404')) {
        raw = 'Summary refine API is not available. Please restart octo-smart-summary with the latest branch.';
    }
    if (status === 503 && raw.toLowerCase().includes('refine service is not configured')) {
        raw = 'Summary refine service is not configured. Please enable LLM config for summary-api.';
    }
    return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

// Backend wraps responses in {code, message, data} envelope — unwrap .data
async function get<T>(path: string, params?: Record<string, unknown>, config?: AxiosRequestConfig): Promise<T> {
    try {
        const resp = await summaryAxios.get(`${BASE}${path}`, { params, ...config });
        return resp.data?.data ?? resp.data;
    } catch (err) {
        // Preserve cancellation identity so callers can use axios.isCancel(err)
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

// P1-5:summary 走 {code,message,data} 信封 —— HTTP200 + code≠0 是**逻辑失败**(见本文件 agentChat 注)。
// 故「动作成功」类事件不能挂 FetchRules 的 2xx 通道(否则失败也计成成功,成功率被失败率隐性冲高)。
// 改为在此按业务码 gate:仅 code===0(明确成功)才命令式 track 一次。
// 放在 api 层 = 天然去重(同一动作多入口共用一个 api 函数,只计一次),且是唯一能看到 code 的位置
// (公共 post/put/del 只 unwrap .data、不看 code,页面成功回调已丢失 code)。
// 二审 P2-5:code===null 不当成功(常见于「{code:null,data:null} 空信封」或网关/HTML 被解析成无 code)。
// 六审 P2:code===undefined 同样不当成功。summary 端点响应恒为 {code,message,data} 信封,**缺 code**
// 意味着这不是预期信封(网关 HTML+200 / {data:null} / 代理错误页)——与 null 同一失败签名,不能计成成功。
// 仅 code===0 才 track。successProps 由调用方按事件语义传入(单一收口点,见二审 P1「双发」)。
function trackOnEnvelopeSuccess(
    resp: { data?: { code?: number } },
    event?: string,
    props: Record<string, unknown> = {},
): void {
    if (!event) return;
    const code = resp?.data?.code;
    if (code === 0) Dap.shared.track(event, props);
}

async function post<T>(path: string, data?: unknown, successEvent?: string, successProps: Record<string, unknown> = {}): Promise<T> {
    try {
        const resp = await summaryAxios.post(`${BASE}${path}`, data);
        trackOnEnvelopeSuccess(resp, successEvent, successProps);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

async function put<T>(path: string, data?: unknown, successEvent?: string, successProps: Record<string, unknown> = {}): Promise<T> {
    try {
        const resp = await summaryAxios.put(`${BASE}${path}`, data);
        trackOnEnvelopeSuccess(resp, successEvent, successProps);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

async function del<T>(path: string, successEvent?: string, successProps: Record<string, unknown> = {}): Promise<T> {
    try {
        const resp = await summaryAxios.delete(`${BASE}${path}`);
        trackOnEnvelopeSuccess(resp, successEvent, successProps);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

// ─── Core Summary Operations ───────────────────────────


export interface SummaryStreamEvent {
    type: "start" | "stage" | "delta" | "snapshot" | "done" | "error" | string;
    task_id?: number;
    run_id?: string;
    scope?: "personal" | "team" | string;
    stage?: string;
    delta?: string;
    content?: string;
    message?: string;
    status?: number;
    result_id?: number;
    version_id?: number;
    version?: number;
    citations?: unknown[];
    team_citations?: unknown[];
    msg_count?: number;
    total_msg_count?: number;
    total_token_used?: number;
    model_version?: string;
    operation_type?: string;
    operation_note?: string;
    parent_result_id?: number | null;
    generated_at?: string;
}

function buildSummaryURL(path: string): string {
    return `${resolveSummaryBaseURL()}${BASE}${path}`;
}

function parseSSEBlock(block: string): SummaryStreamEvent | null {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const rawLine of block.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) {
            eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).trimStart());
        }
    }
    if (dataLines.length === 0) return null;
    const data = dataLines.join("\n");
    if (data === "[DONE]") return { type: "done" };
    try {
        const parsed = JSON.parse(data) as SummaryStreamEvent;
        return { ...parsed, type: parsed.type || eventType };
    } catch {
        return { type: eventType, delta: data };
    }
}

function buildStreamHeaders(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "Accept-Language": buildAcceptLanguage(),
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    const token = WKApp.loginInfo.token;
    if (token) headers.token = token;
    const spaceId = WKApp.shared.currentSpaceId;
    if (spaceId) headers["X-Space-Id"] = spaceId;
    return headers;
}

async function consumeSSE(resp: Response, onEvent: (event: SummaryStreamEvent) => void): Promise<void> {
    if (!resp.body) return;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let match = buffer.match(/\r?\n\r?\n/);
            while (match?.index != null) {
                const block = buffer.slice(0, match.index);
                buffer = buffer.slice(match.index + match[0].length);
                const event = parseSSEBlock(block);
                if (event) onEvent(event);
                match = buffer.match(/\r?\n\r?\n/);
            }
        }
        const tail = buffer.trim();
        if (tail) {
            const event = parseSSEBlock(tail);
            if (event) onEvent(event);
        }
        completed = true;
    } finally {
        if (!completed) {
            try {
                await reader.cancel();
            } catch {
                // ignore cleanup errors
            }
        }
        reader.releaseLock();
    }
}

async function streamRequest(
    path: string,
    init: RequestInit,
    onEvent: (event: SummaryStreamEvent) => void,
): Promise<void> {
    const resp = await fetch(buildSummaryURL(path), init);
    if (resp.status === 401) {
        WKApp.shared.logout();
    }
    if (!resp.ok) {
        let message = `Summary stream failed (${resp.status})`;
        try {
            const data = await resp.json();
            message = data?.message || data?.msg || data?.error || message;
        } catch {
            // ignore non-json error body
        }
        throw new Error(message);
    }
    await consumeSSE(resp, onEvent);
}

export async function streamSummary(
    taskId: number,
    options: {
        scope?: "personal" | "team";
        signal?: AbortSignal;
        onEvent: (event: SummaryStreamEvent) => void;
    },
): Promise<void> {
    const params = new URLSearchParams();
    if (options.scope) params.set("scope", options.scope);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    await streamRequest(`/summaries/${taskId}/stream${suffix}`, {
        method: "GET",
        headers: buildStreamHeaders(),
        signal: options.signal,
    }, options.onEvent);
}

// 二审 P1「smart_summary_started 双发」修复:本事件的**唯一**收口点在 api 层(envelope code===0 才发),
// 而非页面/按钮。因为「HTTP200 + code≠0」是逻辑失败,只有 api 层能看到 code(见 trackOnEnvelopeSuccess)。
// 各创建入口(SummaryCreatePage normal / ChatSummaryNewModal / agent 模式)把维度 props 传进来,
// 由这里按业务码 gate 后发一次 —— 计数与 props 在所有入口一致。
export async function createSummary(
    params: CreateSummaryParams,
    trackProps: Record<string, unknown> = {},
): Promise<{ task_id: number }> {
    return post('/summaries', params, 'smart_summary_started', trackProps);
}

/**
 * 创建 Agent 总结（契约 v1.0）。
 *
 * POST /summary/api/v1/summaries/agent
 * 让后端 agent 自主总结当前对话的产出内容，落库为可检索的交付物。
 * 响应与传统 createSummary 同构：{ task_id, task_no, status, created_at }
 *
 * SUM-850 blocker F2：严格校验信封 code + task_id，避免后端返 2xx 但业务失败
 * （{code: 非零, data: null}）时前端误报成功、清空聊天造成数据丢失。
 * post() helper 只吃 HTTP 错误（transport 层），不校验业务 code，所以此处
 * 显式走 summaryAxios + 检查 envelope，非 0 code / data 缺 task_id 都抛错，
 * 让 UI 层 catch 后能保留 chat 状态。参考 agentChat 里的同样模式。
 */
export async function createAgentSummary(
    params: CreateAgentSummaryParams,
    trackProps: Record<string, unknown> = {},
): Promise<CreateAgentSummaryResult> {
    const resp = await summaryAxios.post(`${BASE}/summaries/agent`, params);
    const envelopeCode = resp.data?.code;
    // 七审 P1:与 trackOnEnvelopeSuccess 同口径,严格 code===0 才算成功。
    // summary 端点响应恒为 {code,message,data} 信封,缺 code(===undefined)与 code===null 同属
    // 「非预期信封」失败签名(网关 HTML+200 / 代理错误页 / {data:null})。此前这里放行 undefined,
    // 而 normal 路径的 gate 已收紧到仅 code===0,两条创建路径就此不一致:一个带 task_id 但缺 code 的响应
    // 会让 agent 模式误发 smart_summary_started 且误清 chat,normal 模式却不发。统一为 code!==0 即失败。
    if (envelopeCode !== 0) {
        // 业务失败（如 40004 session 无产出）或缺/空信封——保留 envelope code 让上层 switch
        const err = new Error(resp.data?.message || 'create agent summary failed') as Error & {
            response?: { data?: { code?: number; message?: string } };
        };
        err.response = { data: resp.data };
        throw err;
    }
    // 八审 P2:走到这里 envelope code 已判定成功(仅 code===0),响应必是预期信封 {code,message,data}。
    // 故只从 data 取;此前的 `?? resp.data` 回退是给「无信封裸响应」用的,而那正是 code===undefined 的情形,
    // 已在上面 :350 rejected —— 回退再也走不到(裸响应没有 task_id,反而会在下面 :361 抛),留着只会
    // 误导「仍支持裸响应」。去掉,语义与实际行为一致。
    const data = resp.data?.data as CreateAgentSummaryResult | undefined;
    if (!data || typeof data.task_id !== 'number' || data.task_id <= 0) {
        // 后端返成功但 task_id 缺失/非法 —— 视为保存失败,不能清 chat
        throw new Error(resp.data?.message || 'create agent summary returned no task_id');
    }
    // 二审 P1/P2-2:agent 模式也是一条「成功发起」。走到这里 envelope code 已判定成功
    // (仅 code===0,缺/空/非零信封均已在上面抛出),与传统 createSummary 的 gate 同口径,
    // 补发 smart_summary_started(此前 agent 模式一次都不发,与 normal 模式不一致)。
    Dap.shared.track('smart_summary_started', trackProps);
    return data;
}

// Agent 交互式问答（非流式一问一答）。POST /summary/api/v1/agent/chat。
// 不复用公共 post()：post() 只 `data?.data ?? data`，不校验业务 code，
// HTTP200 + {code:非0,data:null} 会被当成功、undefined 追进气泡。这里自行
// 校验 envelope，非0 code 或空 reply 时抛错，交给 UI 层 catch。
export async function agentChat(params: AgentChatParams): Promise<AgentChatResult> {
    try {
        // agent 是多步回环（LLM→工具→LLM…），单次问答可能耗时数十秒，
        // 远超默认 20s 超时。给这个请求单独放宽到 120s，避免链路没跑完就被前端掐断。
        const resp = await summaryAxios.post(`${BASE}/agent/chat`, params, { timeout: 120000 });
        if (resp.data?.code !== 0) {
            throw new Error(resp.data?.message || 'agent chat failed');
        }
        const data = resp.data?.data as AgentChatResult | undefined;
        if (!data?.reply) {
            throw new Error(resp.data?.message || 'agent chat failed');
        }
        // SS-11: surface run_id when present (V2 on); omitted by legacy backend.
        return { reply: data.reply, session_id: data.session_id, run_id: data.run_id };
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        if (err instanceof Error) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

// Agent 对话历史回显（只读）。GET /summary/api/v1/agent/chat/history?session_id=xxx。
// 复用公共 get()（envelope 解包 .data + 错误处理），后端按 session_id 返回该会话
// 已持久化的全部消息。data 缺省时兜底为空历史，便于「无历史 → 空白新开场」分支。
export async function getAgentChatHistory(sessionId: string): Promise<AgentChatHistory> {
    const data = await get<AgentChatHistory | null>('/agent/chat/history', { session_id: sessionId });
    return {
        session_id: data?.session_id || sessionId,
        messages: Array.isArray(data?.messages) ? data!.messages : [],
    };
}

/**
 * Agent 交互式问答 SSE 流式版。POST /summary/api/v1/agent/chat/stream。
 * 手动消费 fetch + ReadableStream 解析 SSE 帧(不用 EventSource — EventSource 不支持 POST body)。
 * 
 * @param params - 请求参数(和 agentChat 一致)
 * @param handlers - 事件回调: onProgress / onDone / onError
 * @returns {{ close: () => void }} - 关闭 reader 的句柄,组件卸载/用户取消时调用
 */
export function agentChatStream(
    params: AgentChatParams,
    handlers: AgentStreamHandlers,
): { close: () => void } {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let aborted = false;

    const url = `${resolveSummaryBaseURL()}${BASE}/agent/chat/stream`;
    const token = WKApp.loginInfo.token;
    const spaceId = WKApp.shared.currentSpaceId;

    // 启动消费
    (async () => {
        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream',
                'Accept-Language': buildAcceptLanguage(),
            };
            if (token) headers['token'] = token;
            if (spaceId) headers['X-Space-Id'] = spaceId;

            const resp = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(params),
            });


            if (resp.status === 401) {
                WKApp.shared.logout();
                handlers.onError?.({ code: 401, message: 'Unauthorized', transient: true });
                return;
            }
            if (!resp.ok) {
                const text = await resp.text();
                let errMsg = `HTTP ${resp.status}`;
                try {
                    const json = JSON.parse(text);
                    errMsg = json?.message || errMsg;
                } catch {
                    // text 不是 JSON,用 HTTP status
                }
                throw new Error(errMsg);
            }

            if (!resp.body) {
                throw new Error('Response body is null');
            }

            reader = resp.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            let pendingEvent = '';
            let pendingData = '';
            let receivedDone = false;
            let receivedError = false;
            while (!aborted) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                // SSE 标准帧分隔是 \r\n\r\n 或 \n\n;规范化 CRLF/CR → LF,再按 \n 拆
                // (SUM-850 blocker A / #850 Jerry-Xin: 若只按 \n 拆 CRLF 流,空行会是 '\r'
                // 而非 ''，边界永远不触发 → progress/done 事件不 dispatch → UI 判 stream
                // 结束时未收 done、错误回退甚至消息双发。同文件另一处 parser 也是这么处理的)。
                const lines = buffer.replace(/\r\n?/g, '\n').split('\n');
                buffer = lines.pop() || ''; // 最后一行可能不完整,留在 buffer


                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        pendingEvent = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        pendingData += (pendingData ? "\n" : "") + line.slice(5).trim();
                    } else if (line === '') {
                        // 空行是帧边界,解析并分发
                        if (pendingEvent && pendingData) {
                            const dispatched = parseAndDispatch(pendingEvent, pendingData, handlers);
                            if (dispatched) {
                                if (pendingEvent === 'done') {
                                    receivedDone = true;
                                } else if (pendingEvent === 'error') {
                                    receivedError = true;
                                }
                            }
                        }
                        pendingEvent = '';
                        pendingData = '';
                    }
                }
            }
            // Tail flush: 流关闭后如果 buffer / pending 里还有未 dispatch 的 frame
            // (最后一个 event 没跟空行边界),补一次 dispatch。以及 buffer 里可能还有
            // 一行未按 \n 结束的尾巴 —— 也当一行处理。(SUM-850 blocker A / Jerry-Xin)
            if (!aborted) {
                if (buffer) {
                    const trailingLine = buffer.replace(/\r\n?/g, '\n');
                    if (trailingLine.startsWith('event:')) {
                        pendingEvent = trailingLine.slice(6).trim();
                    } else if (trailingLine.startsWith('data:')) {
                        pendingData += (pendingData ? '\n' : '') + trailingLine.slice(5).trim();
                    }
                    buffer = '';
                }
                if (pendingEvent && pendingData) {
                    const dispatched = parseAndDispatch(pendingEvent, pendingData, handlers);
                    if (dispatched) {
                        if (pendingEvent === 'done') {
                            receivedDone = true;
                        } else if (pendingEvent === 'error') {
                            receivedError = true;
                        }
                    }
                }
            }
            // 流已关闭,但如果没收到 done 事件,触发错误让 UI 解锁
            if (!aborted && !receivedDone && !receivedError) {
                handlers.onError?.({ code: 50000, message: 'stream closed without done', transient: true });
            }
        } catch (err: unknown) {
            if (aborted) return; // 用户手动关闭,不回调 error
            const msg = err instanceof Error ? err.message : String(err);
            handlers.onError?.({ code: 50000, message: msg, transient: true });
        } finally {
            reader?.releaseLock();
        }
    })();

    return {
        close: () => {
            aborted = true;
            reader?.cancel();
        },
    };
}

/** 解析 SSE data 并分发；仅成功处理已知事件时返回 true。 */
function parseAndDispatch(event: string, data: string, handlers: AgentStreamHandlers): boolean {
    try {
        const parsed = JSON.parse(data);
        switch (event) {
            case 'progress':
                handlers.onProgress?.(parsed as AgentProgressEvent);
                return true;
            case 'done':
                handlers.onDone?.(parsed as AgentDoneEvent);
                return true;
            case 'error':
                handlers.onError?.(parsed as AgentErrorEvent);
                return true;
            default:
                // 未知事件忽略
                return false;
        }
    } catch (err) {
        // JSON 解析失败,忽略该帧
        console.warn('Failed to parse SSE data:', data, err);
        return false;
    }
}

export async function listSummaries(
    params: ListSummariesParams,
    config?: { signal?: AbortSignal },
): Promise<ListSummariesResponse> {
    return get('/summaries', params as Record<string, unknown>, config);
}

export async function getSummaryDetail(taskId: number | string): Promise<SummaryDetail> {
    return get(`/summaries/${encodeURIComponent(String(taskId))}`);
}

export async function createSummaryShares(
    taskId: number | string,
    idempotencyKey: string,
    targets: Array<{ channel_id: string; channel_type: number }>,
): Promise<CreateSummarySharesResponse> {
    return post(`/summaries/${encodeURIComponent(String(taskId))}/shares`, {
        idempotency_key: idempotencyKey,
        targets,
    });
}

export async function getSummaryShare(shareId: string, spaceId?: string): Promise<GetSummaryShareResponse> {
    return get(
        `/summary-shares/${encodeURIComponent(shareId)}`,
        undefined,
        spaceId ? { headers: { 'X-Space-Id': spaceId } } : undefined,
    );
}

export async function revokeSummaryShare(shareId: string): Promise<void> {
    await del(`/summary-shares/${encodeURIComponent(shareId)}`);
}

export async function markSummaryRead(
    taskId: number,
    cursors: { team_result_id?: number; personal_version_id?: number },
): Promise<{ is_unread: boolean; has_pending_invitation: boolean; needs_attention: boolean }> {
    return post(`/summaries/${taskId}/read`, cursors);
}

export async function deleteSummary(taskId: number): Promise<void> {
    return del(`/summaries/${taskId}`, 'smart_summary_deleted');
}

export async function regenerateSummary(taskId: number, body?: { topic?: string }): Promise<{ task_id: number }> {
    return post(`/summaries/${taskId}/regenerate`, body, 'smart_summary_regenerated');
}

export async function streamRefineSummary(
    taskId: number,
    body: { feedback: string; base_result_id: number },
    options: { signal?: AbortSignal; onEvent: (event: SummaryStreamEvent) => void },
): Promise<void> {
    await streamRequest(`/summaries/${taskId}/refine/stream`, {
        method: "POST",
        headers: buildStreamHeaders(true),
        body: JSON.stringify(body),
        signal: options.signal,
    }, options.onEvent);
}

export async function refineSummary(
    taskId: number,
    body: { feedback: string; base_result_id: number },
): Promise<{
    task_id: number;
    result_id: number;
    version: number;
    content: string;
    citations?: unknown[];
    team_citations?: unknown[];
    total_msg_count?: number;
    total_token_used?: number;
    model_version?: string;
    operation_type?: string;
    operation_note?: string;
    parent_result_id?: number | null;
    generated_at?: string;
}> {
    try {
        const resp = await summaryAxios.post(`${BASE}/summaries/${taskId}/refine`, body, { timeout: 95000 });
        return resp.data?.data ?? resp.data;
    } catch (err: unknown) {
        if (axios.isCancel(err)) throw err;
        const axiosErr = err as { code?: string; response?: { status?: number } };
        const msg = axiosErr?.code === 'ECONNABORTED'
            ? 'Summary refine request timed out. Please check whether summary-api can reach the LLM service.'
            : extractErrorMessage(err);
        const error = new Error(msg) as Error & { status?: number };
        if (axiosErr?.response?.status) error.status = axiosErr.response.status;
        throw error;
    }
}


export async function regeneratePersonalSummary(
    taskId: number,
    body?: { topic?: string },
): Promise<{ task_id: number; result_id: number; status: number }> {
    // 八审 P2:BY_PERSON 多人协作的「个人报告」整条重生成,与 regenerateSummary(团队整体重生成)
    // 同属一次 full regenerate,漏斗 smart_summary_regenerated 必须计入,否则 dialog_opened→regenerated
    // 比值只反映埋点覆盖而非用户行为。走 post() 的 code===0 gate,与团队路径同口径。
    // (注:refine-by-feedback 是「反馈微调」的另一种交互,不是 full regenerate,不计本事件;见 DAP_EVENTS.md。)
    return post(`/summaries/${taskId}/personal-regenerate`, body, 'smart_summary_regenerated');
}

export async function streamRefinePersonalSummary(
    taskId: number,
    body: { feedback: string; base_result_id: number; base_version?: number },
    options: { signal?: AbortSignal; onEvent: (event: SummaryStreamEvent) => void },
): Promise<void> {
    await streamRequest(`/summaries/${taskId}/personal-refine/stream`, {
        method: "POST",
        headers: buildStreamHeaders(true),
        body: JSON.stringify(body),
        signal: options.signal,
    }, options.onEvent);
}

export async function refinePersonalSummary(
    taskId: number,
    body: { feedback: string; base_result_id: number; base_version?: number },
): Promise<{
    task_id: number;
    result_id: number;
    version_id?: number;
    version: number;
    content: string;
    citations?: unknown[];
    msg_count?: number;
    total_token_used?: number;
    model_version?: string;
    operation_type?: string;
    operation_note?: string;
    parent_result_id?: number | null;
    generated_at?: string;
}> {
    try {
        const resp = await summaryAxios.post(`${BASE}/summaries/${taskId}/personal-refine`, body, { timeout: 95000 });
        return resp.data?.data ?? resp.data;
    } catch (err: unknown) {
        if (axios.isCancel(err)) throw err;
        const axiosErr = err as { code?: string; response?: { status?: number } };
        const msg = axiosErr?.code === 'ECONNABORTED'
            ? 'Summary refine request timed out. Please check whether summary-api can reach the LLM service.'
            : extractErrorMessage(err);
        const error = new Error(msg) as Error & { status?: number };
        if (axiosErr?.response?.status) error.status = axiosErr.response.status;
        throw error;
    }
}

export async function listPersonalSummaryVersions(
    taskId: number,
    limit = 3,
): Promise<{ versions: SummaryVersionItem[]; keep_limit: number }> {
    return get(`/summaries/${taskId}/personal-versions`, { limit });
}

export async function restorePersonalSummaryVersion(
    taskId: number,
    versionId: number,
): Promise<{ task_id: number; result_id: number; version_id: number; version: number }> {
    return post(`/summaries/${taskId}/personal-versions/${versionId}/restore`);
}

export async function getPersonalSummaryVersion(
    taskId: number,
    versionId: number,
): Promise<SummaryVersionDetail> {
    return get(`/summaries/${taskId}/personal-versions/${versionId}`);
}

export async function listSummaryVersions(
    taskId: number,
    limit = 3,
): Promise<{ versions: SummaryVersionItem[]; keep_limit: number }> {
    return get(`/summaries/${taskId}/versions`, { limit });
}

export async function restoreSummaryVersion(
    taskId: number,
    resultId: number,
): Promise<{ task_id: number; result_id: number; version: number }> {
    return post(`/summaries/${taskId}/versions/${resultId}/restore`);
}

export async function getSummaryVersion(
    taskId: number,
    resultId: number,
): Promise<SummaryVersionDetail> {
    return get(`/summaries/${taskId}/versions/${resultId}`);
}

// 不复用 put helper，因为需要保留 HTTP status 区分 409（冲突）和 5xx（服务错误）
export async function editSummary(
    taskId: number,
    content: string,
    baseResultId: number,
): Promise<{ edited_at: string }> {
    try {
        const resp = await summaryAxios.put(`${BASE}/summaries/${taskId}/edit`, {
            content,
            base_result_id: baseResultId,
        });
        trackOnEnvelopeSuccess(resp, 'smart_summary_edited');
        return resp.data?.data ?? resp.data;
    } catch (err: unknown) {
        // Preserve cancellation identity so callers can use axios.isCancel(err)
        if (axios.isCancel(err)) throw err;
        const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } } };
        const status = axiosErr?.response?.status;
        const msg = extractErrorMessage(err);
        const error = new Error(msg) as Error & { status?: number };
        if (status) error.status = status;
        throw error;
    }
}

// need3 + need6：编辑「自己的个人报告」。后端按 (task_id, user_id=自己) 定位，
// 只能改自己那条，无法触碰他人；成功后后端自动触发团队总结重算（meta_summary）。
// F2：body 严格 {content}——后端 PersonalEdit 只 bind content，不带 base_result_id（契约清洁）。
export async function personalEditSummary(
    taskId: number,
    content: string,
): Promise<{ edited_at: string }> {
    return put(`/summaries/${taskId}/personal-edit`, { content });
}

// OCT-21（提交前编辑）/ v2 F1：提交前编辑「自己的个人报告」草稿。
// 后端按 (task_id, user_id=自己) 定位，只能改自己；不写 edited_at、不 revive、
// 不触发团队重算。仅当 worker_status===2 && submitted_at IS NULL 时允许；
// 已提交后请改用 personalEditSummary（后端会重算团队）。
// 不复用 put helper（理由同 editSummary，见 line 146-168 注释）：
// SummaryEditor.handleSave 的 409 分支硬依赖 error.status === 409，
// put helper 的 catch 把 axios error 转成 new Error(extractErrorMessage(err))，
// 丢失 response.status -> 409 分支永远不触发，编辑器无法关闭。
export async function personalDraftSummary(
    taskId: number,
    content: string,
): Promise<void> {
    try {
        await summaryAxios.put(`${BASE}/summaries/${taskId}/personal-draft`, { content });
    } catch (err: unknown) {
        // Preserve cancellation identity so callers can use axios.isCancel(err)
        if (axios.isCancel(err)) throw err;
        const axiosErr = err as { response?: { status?: number } };
        const status = axiosErr?.response?.status;
        const msg = extractErrorMessage(err);
        const error = new Error(msg) as Error & { status?: number };
        if (status) error.status = status;
        throw error;
    }
}

// need7：creator 添加新成员。body={user_ids:[...]}（以后端 addMembersReq.UserIDs
// 为准，见 octo-smart-summary/internal/api/handler/personal.go AddMembers）。
// 新成员以「待确认」(Pending) 进入成员状态列表，等其自己 Accept 才生成个人+并入团队。
export async function addMembers(taskId: number, userIds: string[]): Promise<void> {
    return post(`/summaries/${taskId}/members`, { user_ids: userIds });
}

// 退出多人协作（参与者，非 creator）。后端物理删除调用者的
// participant + personal_result 行，并重算团队总结（meta_summary）。
export async function leaveSummary(taskId: number): Promise<void> {
    return post(`/summaries/${taskId}/leave`);
}

// creator 移除某成员。后端物理删除该成员的 participant + personal_result
// 行，并重算团队总结。creator 不可被移除。
export async function removeMember(taskId: number, uid: string): Promise<void> {
    return del(`/summaries/${taskId}/members?uid=${encodeURIComponent(uid)}`);
}


// refineAgentSummary 已移除 — 反馈修改改为在智能总结 chat 里引用总结迭代
// (见 CHAT-REFERENCE-BASED-DESIGN-v1)。后端 POST /summaries/:id/refine 端点也已删除。

// ─── Status Management ─────────────────────────────────

export async function batchStatus(taskIds: number[]): Promise<BatchStatusItem[]> {
    const data = await post<BatchStatusResponse>('/summaries/batch-status', {
        task_ids: taskIds,
    });
    return data?.tasks ?? [];
}

export async function cancelSummary(taskId: number): Promise<void> {
    return post(`/summaries/${taskId}/cancel`);
}

export async function confirmParticipation(taskId: number, sources: SourceItem[]): Promise<void> {
    return post(`/summaries/${taskId}/confirm`, {
        sources: sources.map((s) => ({
            source_type: s.source_type,
            source_id: s.source_id,
        })),
    });
}

export async function declineParticipation(taskId: number): Promise<void> {
    return post(`/summaries/${taskId}/decline`);
}

export async function acceptInvitation(taskId: number): Promise<void> {
    return post(`/summaries/${taskId}/accept`);
}

export async function respondToTask(taskId: number, action: 'accept' | 'reject'): Promise<void> {
    return post(`/summaries/${taskId}/respond`, { action });
}

// ─── Personal Results ──────────────────────────────────

export async function getPersonalResult(taskId: number): Promise<PersonalResult> {
    return get(`/summaries/${taskId}/personal`);
}

export async function submitPersonalResult(taskId: number): Promise<void> {
    return post(`/summaries/${taskId}/submit`);
}

export async function getMembers(taskId: number): Promise<MemberStatus[]> {
    const data = await get<{ members: MemberStatus[] }>(`/summaries/${taskId}/members`);
    return data?.members || [];
}

// ─── Participants & Data ───────────────────────────────

export async function getParticipants(taskId: number): Promise<Participant[]> {
    const data = await get<{ participants: Participant[] }>(`/summaries/${taskId}/participants`);
    return data.participants;
}

export async function getTemplates(): Promise<SummaryTemplate[]> {
    const data = await get<{ templates: TopicTemplate[] }>('/summary-templates');
    return (data?.templates || []).map(t => ({
        template_id: t.id,
        name: t.label,
        description: t.description,
        default_mode: SummaryMode.BY_GROUP,
        default_time_range_type: 1 as const,
    }));
}

export async function getTopicTemplatesConfig(): Promise<TopicTemplatesResponse> {
    const data = await get<Partial<TopicTemplatesResponse>>('/summary-templates');
    return {
        templates: data?.templates || [],
        custom_template_limit: data?.custom_template_limit ?? 30,
    };
}

export async function getTopicTemplates(): Promise<TopicTemplate[]> {
    const data = await getTopicTemplatesConfig();
    return data.templates;
}

export async function updateMyTopicTemplate(
    templateId: string,
    payload: CustomTopicTemplatePayload,
): Promise<TopicTemplate> {
    const data = await put<{ template: TopicTemplate }>(`/summary-templates/${encodeURIComponent(templateId)}/my`, payload);
    return data.template;
}

export async function resetMyTopicTemplate(templateId: string): Promise<TopicTemplate> {
    const data = await del<{ template: TopicTemplate }>(`/summary-templates/${encodeURIComponent(templateId)}/my`);
    return data.template;
}

export async function createCustomTopicTemplate(payload: CustomTopicTemplatePayload): Promise<TopicTemplate> {
    const data = await post<{ template: TopicTemplate }>('/summary-templates/my', payload, 'smart_summary_custom_template_created');
    return data.template;
}

export async function updateCustomTopicTemplate(
    templateId: string,
    payload: CustomTopicTemplatePayload,
): Promise<TopicTemplate> {
    const data = await put<{ template: TopicTemplate }>(`/summary-templates/my/${encodeURIComponent(templateId)}`, payload);
    return data.template;
}

export async function deleteCustomTopicTemplate(templateId: string): Promise<void> {
    return del(`/summary-templates/my/${encodeURIComponent(templateId)}`);
}

export async function inferScope(topic: string): Promise<InferResult> {
    return get('/summary-infer', { topic } as Record<string, unknown>);
}

// ─── Schedule CRUD ─────────────────────────────────────

// 后端 is_active 序列化为 number(0/1)，而前端 ScheduleItem.is_active 声明为 boolean，
// 且多处用严格比较（`is_active === false` / `!== false`）判断定时是否生效。
// `0 === false` 为 false，会导致「关闭后刷新仍显示定时生效」。这里在 API 边界统一
// 把 is_active 归一为 boolean，所有消费方判断即可正确（不依赖后端类型，亦无需改后端）。
function normalizeScheduleItem<T extends { is_active?: unknown } | null | undefined>(item: T): T {
    if (!item || typeof item !== 'object') return item;
    const v = (item as { is_active?: unknown }).is_active;
    return { ...(item as object), is_active: v === true || v === 1 || v === '1' } as T;
}

export async function getSchedule(scheduleId: number): Promise<ScheduleItem> {
    return normalizeScheduleItem(await get<ScheduleItem>(`/summary-schedules/${scheduleId}`));
}

export async function createSchedule(params: CreateScheduleParams): Promise<ScheduleItem> {
    return normalizeScheduleItem(await post<ScheduleItem>('/summary-schedules', params, 'smart_summary_timer_configured'));
}

export async function listSchedules(): Promise<ScheduleItem[]> {
    const data = await get<ScheduleItem[]>('/summary-schedules');
    return (data || []).map(normalizeScheduleItem);
}

export async function updateSchedule(scheduleId: number, params: UpdateScheduleParams): Promise<ScheduleItem> {
    return normalizeScheduleItem(await put<ScheduleItem>(`/summary-schedules/${scheduleId}`, params, 'smart_summary_timer_configured'));
}

export async function deleteSchedule(scheduleId: number): Promise<void> {
    return del(`/summary-schedules/${scheduleId}`);
}

export async function toggleSchedule(scheduleId: number, isActive: boolean): Promise<ScheduleItem> {
    return normalizeScheduleItem(await put<ScheduleItem>(`/summary-schedules/${scheduleId}/toggle`, { is_active: isActive }));
}

// V5：schedule 级「一次性确认」。对当前登录用户在该 schedule 的 participant_config
// 里置 confirmed=true（后端处理）。语义是「确认这个定时任务，确认一次后续
// 每轮免确认」，不是确认某一轮 task。
export async function confirmSchedule(scheduleId: number): Promise<void> {
    return post(`/summary-schedules/${scheduleId}/confirm`);
}

// ─── Candidate Selection ───────────────────────────────

export async function getChatCandidates(params?: { keyword?: string; chat_type?: string; include_archived?: boolean }): Promise<ChatCandidate[]> {
    const data = await get<ChatCandidate[]>('/summary-chat-candidates', params as Record<string, unknown>);
    return data || [];
}

export async function getMemberCandidates(params?: { keyword?: string }): Promise<MemberCandidate[]> {
    const data = await get<MemberCandidate[]>('/summary-member-candidates', params as Record<string, unknown>);
    return data || [];
}
// ─── Copy & Convert to Document (octo-smart-summary#195) ────────────────

/**
 * 转为在线文档。
 *
 * 注意这里**不含任何 docs-backend REST 调用**：`packages/docs` 已在
 * `#1363 feat: detach docs module from oss host` 之后从本仓库移除并被 oss-module-guard
 * 禁止加回，OSS 侧直连它的 REST 端点会在没有部署 docs-backend 的形态下必然失败。
 * 实际的「建文档 → 导入 markdown →（失败时）回滚」全部由闭源 docs 模块在
 * `EndpointID.docsConvertMarkdown` 端口后面实现，跳转链接也由它用 buildDocLink 生成。
 *
 * 端口未接线（docsOn 关闭或 docs 模块不在当前 bundle 里）时抛
 * DocsCapabilityUnavailableError —— 但调用方本就该用 isDocsConvertAvailable() 提前
 * 隐藏入口，正常路径上不会走到这个分支。
 */
export async function convertSummaryToDoc(title: string, markdown: string): Promise<{ docId: string; url: string }> {
    return convertMarkdownToDoc({ title, markdown });
}
