import axios, { AxiosRequestConfig } from 'axios';
import { WKApp, buildAcceptLanguage } from '@octo/base';
import type {
    ApiResponse,
    BatchStatusItem,
    BatchStatusResponse,
    ChatCandidate,
    CreateSummaryParams,
    CreateScheduleParams,
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
    TopicTemplate,
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
    const axiosErr = err as { response?: { data?: { message?: string } } };
    const msg = axiosErr?.response?.data?.message;
    const raw = msg || (err instanceof Error ? err.message : 'Request failed');
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

export async function createSummary(params: CreateSummaryParams): Promise<{ task_id: number }> {
    return post('/summaries', params);
}

export async function listSummaries(
    params: ListSummariesParams,
    config?: { signal?: AbortSignal },
): Promise<ListSummariesResponse> {
    return get('/summaries', params as Record<string, unknown>, config);
}

export async function getSummaryDetail(taskId: number): Promise<SummaryDetail> {
    return get(`/summaries/${taskId}`);
}

export async function deleteSummary(taskId: number): Promise<void> {
    return del(`/summaries/${taskId}`);
}

export async function regenerateSummary(taskId: number, body?: { topic?: string }): Promise<{ task_id: number }> {
    return post(`/summaries/${taskId}/regenerate`, body);
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

export async function getTopicTemplates(): Promise<TopicTemplate[]> {
    const data = await get<{ templates: TopicTemplate[] }>('/summary-templates');
    return data?.templates || [];
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
