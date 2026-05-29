import axios from 'axios';
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
    UpdateScheduleParams,
} from '../types/summary';

const summaryAxios = axios.create({ baseURL: '' });

summaryAxios.interceptors.request.use((config) => {
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
    const axiosErr = err as { response?: { data?: { error?: { message?: string } } } };
    const msg = axiosErr?.response?.data?.error?.message;
    const raw = msg || (err instanceof Error ? err.message : 'Request failed');
    return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}

// Backend wraps responses in {code, message, data} envelope — unwrap .data
async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    try {
        const resp = await summaryAxios.get(`${BASE}${path}`, { params });
        return resp.data?.data ?? resp.data;
    } catch (err) {
        throw new Error(extractErrorMessage(err));
    }
}

async function post<T>(path: string, data?: unknown): Promise<T> {
    try {
        const resp = await summaryAxios.post(`${BASE}${path}`, data);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        throw new Error(extractErrorMessage(err));
    }
}

async function put<T>(path: string, data?: unknown): Promise<T> {
    try {
        const resp = await summaryAxios.put(`${BASE}${path}`, data);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        throw new Error(extractErrorMessage(err));
    }
}

async function del<T>(path: string): Promise<T> {
    try {
        const resp = await summaryAxios.delete(`${BASE}${path}`);
        return resp.data?.data ?? resp.data;
    } catch (err) {
        throw new Error(extractErrorMessage(err));
    }
}

// ─── Core Summary Operations ───────────────────────────

export async function createSummary(params: CreateSummaryParams): Promise<{ task_id: number }> {
    return post('/summaries', params);
}

export async function listSummaries(params: ListSummariesParams): Promise<ListSummariesResponse> {
    return get('/summaries', params as Record<string, unknown>);
}

export async function getSummaryDetail(taskId: number): Promise<SummaryDetail> {
    return get(`/summaries/${taskId}`);
}

export async function deleteSummary(taskId: number): Promise<void> {
    return del(`/summaries/${taskId}`);
}

export async function regenerateSummary(taskId: number): Promise<{ task_id: number }> {
    return post(`/summaries/${taskId}/regenerate`);
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
        const axiosErr = err as { response?: { status?: number; data?: { error?: { message?: string } } } };
        const status = axiosErr?.response?.status;
        const msg = extractErrorMessage(err);
        const error = new Error(msg) as Error & { status?: number };
        if (status) error.status = status;
        throw error;
    }
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
    const data = await get<SummaryTemplate[]>('/summary-templates');
    return data || [];
}

export async function inferScope(topic: string): Promise<InferResult> {
    return get('/summary-infer', { topic } as Record<string, unknown>);
}

// ─── Schedule CRUD ─────────────────────────────────────

export async function getSchedule(scheduleId: number): Promise<ScheduleItem> {
    return get(`/summary-schedules/${scheduleId}`);
}

export async function createSchedule(params: CreateScheduleParams): Promise<ScheduleItem> {
    return post('/summary-schedules', params);
}

export async function listSchedules(): Promise<ScheduleItem[]> {
    const data = await get<ScheduleItem[]>('/summary-schedules');
    return data || [];
}

export async function updateSchedule(scheduleId: number, params: UpdateScheduleParams): Promise<ScheduleItem> {
    return put(`/summary-schedules/${scheduleId}`, params);
}

export async function deleteSchedule(scheduleId: number): Promise<void> {
    return del(`/summary-schedules/${scheduleId}`);
}

export async function toggleSchedule(scheduleId: number, isActive: boolean): Promise<ScheduleItem> {
    return put(`/summary-schedules/${scheduleId}/toggle`, { is_active: isActive });
}

// ─── Candidate Selection ───────────────────────────────

export async function getChatCandidates(params?: { keyword?: string; chat_type?: string }): Promise<ChatCandidate[]> {
    const data = await get<ChatCandidate[]>('/summary-chat-candidates', params as Record<string, unknown>);
    return data || [];
}

export async function getMemberCandidates(params?: { keyword?: string }): Promise<MemberCandidate[]> {
    const data = await get<MemberCandidate[]>('/summary-member-candidates', params as Record<string, unknown>);
    return data || [];
}
