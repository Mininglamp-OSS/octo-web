import axios, { AxiosRequestConfig } from 'axios';
import { WKApp, buildAcceptLanguage } from '@octo/base';
import type {
    ApiResponse,
    BatchStatusItem,
    BatchStatusResponse,
    ChatCandidate,
    CreateSummaryParams,
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
    SummaryDetail,
    SummaryTemplate,
    SummaryVersionDetail,
    SummaryVersionItem,
    TopicTemplate,
    TopicTemplatesResponse,
    UpdateScheduleParams,
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
    if (spaceId) {
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

async function post<T>(path: string, data?: unknown): Promise<T> {
    try {
        const resp = await summaryAxios.post(`${BASE}${path}`, data);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

async function put<T>(path: string, data?: unknown): Promise<T> {
    try {
        const resp = await summaryAxios.put(`${BASE}${path}`, data);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        if (axios.isCancel(err)) throw err;
        throw new Error(extractErrorMessage(err));
    }
}

async function del<T>(path: string): Promise<T> {
    try {
        const resp = await summaryAxios.delete(`${BASE}${path}`);
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

export async function createSummary(params: CreateSummaryParams): Promise<{ task_id: number }> {
    return post('/summaries', params);
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

export async function markSummaryRead(
    taskId: number,
    cursors: { team_result_id?: number; personal_version_id?: number },
): Promise<{ is_unread: boolean; has_pending_invitation: boolean; needs_attention: boolean }> {
    return post(`/summaries/${taskId}/read`, cursors);
}

export async function deleteSummary(taskId: number): Promise<void> {
    return del(`/summaries/${taskId}`);
}

export async function regenerateSummary(taskId: number, body?: { topic?: string }): Promise<{ task_id: number }> {
    return post(`/summaries/${taskId}/regenerate`, body);
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
    return post(`/summaries/${taskId}/personal-regenerate`, body);
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
    const data = await post<{ template: TopicTemplate }>('/summary-templates/my', payload);
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
    return normalizeScheduleItem(await post<ScheduleItem>('/summary-schedules', params));
}

export async function listSchedules(): Promise<ScheduleItem[]> {
    const data = await get<ScheduleItem[]>('/summary-schedules');
    return (data || []).map(normalizeScheduleItem);
}

export async function updateSchedule(scheduleId: number, params: UpdateScheduleParams): Promise<ScheduleItem> {
    return normalizeScheduleItem(await put<ScheduleItem>(`/summary-schedules/${scheduleId}`, params));
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
