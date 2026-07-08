/**
 * MSW handlers for summary API endpoints.
 */
import { http, HttpResponse } from 'msw';
import type { SummaryListItem, SummaryDetail, ScheduleItem, ChatCandidate, MemberCandidate, PersonalResult, BatchStatusItem, MemberStatus, TopicTemplate } from '../types/summary';

let taskCounter = 100;
const mockTasks = new Map<number, SummaryDetail>();
const mockSchedules = new Map<number, ScheduleItem>();

function initMockData() {
    if (mockTasks.size > 0) return;
    const now = new Date().toISOString();
    mockTasks.set(1, {
        task_id: 1, task_no: 'SUM-20260706-001', title: '项目进展总结',
        summary_mode: 1, status: 3, trigger_type: 1,
        time_range_start: '2026-07-05T00:00:00Z', time_range_end: '2026-07-06T00:00:00Z',
        sources: [{ source_type: 1, source_id: 'group-123', source_name: '项目组' }],
        participants: [{ user_id: 'user-1', user_name: '张三', status: 1 }],
        result: { content: '# 总结', total_msg_count: 150, total_token_used: 2048, model_version: 'v2.1', version: 1, generated_at: now },
        error_message: null, origin_channel_id: 'group-123', origin_channel_type: 1,
        created_at: now, updated_at: now,
        permissions: { can_edit: false, can_schedule: true, can_edit_team: true, can_edit_personal: true, can_view_schedule: true, can_add_member: true, can_remove_member: true },
    });
}

export const summaryHandlers = [
    http.post('/summary/api/v1/summaries', async ({ request }) => {
        const body = await request.json() as any;
        const taskId = ++taskCounter;
        const now = new Date().toISOString();
        mockTasks.set(taskId, { task_id: taskId, task_no: `SUM-${Date.now()}`, title: body.topic || '新总结', summary_mode: body.summary_mode || 1, status: 0, trigger_type: 1, time_range_start: now, time_range_end: now, sources: body.sources || [], participants: body.participants || [], result: null, error_message: null, origin_channel_id: '', origin_channel_type: 1, created_at: now, updated_at: now });
        return HttpResponse.json({ code: 0, message: 'success', data: { task_id: taskId } });
    }),
    // Agent summary endpoint - allows offline testing of agent mode
    http.post('/summary/api/v1/summaries/agent', async ({ request }) => {
        const body = await request.json() as any;
        const taskId = ++taskCounter;
        const now = new Date().toISOString();
        mockTasks.set(taskId, { task_id: taskId, task_no: `AGENT-${Date.now()}`, title: body.requirement || 'Agent 总结', summary_mode: 2, status: 0, trigger_type: 2, time_range_start: now, time_range_end: now, sources: body.sources || [], participants: [], result: null, error_message: null, origin_channel_id: body.origin_channel_id || '', origin_channel_type: body.origin_channel_type || 1, created_at: now, updated_at: now });
        return HttpResponse.json({ code: 0, message: 'success', data: { task_id: taskId } });
    }),
    // Agent 交互式问答（非流式一问一答）。mock 回显 message 并回传同一 session_id。
    http.post('/summary/api/v1/agent/chat', async ({ request }) => {
        const body = await request.json() as any;
        return HttpResponse.json({ code: 0, message: 'success', data: { reply: `echo: ${body.message}`, session_id: body.session_id || 's-mock' } });
    }),
    http.get('/summary/api/v1/summaries', ({ request }) => {
        const url = new URL(request.url);
        const page = parseInt(url.searchParams.get('page') || '1');
        const pageSize = parseInt(url.searchParams.get('page_size') || '20');
        const keyword = url.searchParams.get('keyword');
        initMockData();
        let items: SummaryListItem[] = Array.from(mockTasks.values()).map((t) => ({ task_id: t.task_id, task_no: t.task_no, title: t.title, summary_mode: t.summary_mode, status: t.status, trigger_type: t.trigger_type, time_range_start: t.time_range_start, time_range_end: t.time_range_end, sources: t.sources, participants: t.participants, total_msg_count: t.result?.total_msg_count || 0, creator_name: '测试用户', origin_channel_id: t.origin_channel_id, origin_channel_type: t.origin_channel_type, created_at: t.created_at, completed_at: null }));
        if (keyword) items = items.filter((i) => i.title.includes(keyword));
        return HttpResponse.json({ code: 0, message: 'success', data: { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length } });
    }),
    http.get('/summary/api/v1/summaries/:taskId', ({ params }) => {
        const task = mockTasks.get(parseInt(params.taskId as string));
        return task ? HttpResponse.json({ code: 0, message: 'success', data: task }) : HttpResponse.json({ code: 404, message: 'Not found', data: null }, { status: 404 });
    }),
    http.delete('/summary/api/v1/summaries/:taskId', ({ params }) => { mockTasks.delete(parseInt(params.taskId as string)); return HttpResponse.json({ code: 0, message: 'success', data: null }); }),
    http.put('/summary/api/v1/summaries/:taskId/edit', async ({ params, request }) => { const task = mockTasks.get(parseInt(params.taskId as string)); if (task?.result) { const body = await request.json() as any; task.result.content = body.content; task.result.version += 1; task.result_edited_at = new Date().toISOString(); task.result_is_edited = true; } return HttpResponse.json({ code: 0, message: 'success', data: { edited_at: new Date().toISOString() } }); }),
    http.put('/summary/api/v1/summaries/:taskId/personal-edit', async () => HttpResponse.json({ code: 0, message: 'success', data: { edited_at: new Date().toISOString() } })),
    http.put('/summary/api/v1/summaries/:taskId/personal-draft', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/submit', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/members', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.delete('/summary/api/v1/summaries/:taskId/members', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/leave', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/cancel', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/confirm', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/decline', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/accept', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/respond', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.post('/summary/api/v1/summaries/:taskId/regenerate', async () => HttpResponse.json({ code: 0, message: 'success', data: { task_id: 1 } })),
    http.post('/summary/api/v1/summaries/batch-status', async ({ request }) => { const body = await request.json() as any; const tasks: BatchStatusItem[] = (body.task_ids || []).map((id: number) => { const t = mockTasks.get(id); return { id, status: t?.status || 0, progress: t?.status === 3 ? 100 : 50, updated_at: t?.updated_at || new Date().toISOString() }; }); return HttpResponse.json({ code: 0, message: 'success', data: { tasks } }); }),
    http.get('/summary/api/v1/summaries/:taskId/personal', async () => HttpResponse.json({ code: 0, message: 'success', data: { worker_status: 2, content: '# 个人总结', submitted_at: null, generated_at: new Date().toISOString(), msg_count: 50 } as PersonalResult })),
    http.get('/summary/api/v1/summaries/:taskId/members', async ({ params }) => { const task = mockTasks.get(parseInt(params.taskId as string)); return HttpResponse.json({ code: 0, message: 'success', data: { members: (task?.participants.map((p) => ({ user_id: p.user_id, user_name: p.user_name || '', status: 'confirmed', submitted_at: null })) || []) as MemberStatus[] } }); }),
    http.get('/summary/api/v1/summaries/:taskId/participants', async ({ params }) => { const task = mockTasks.get(parseInt(params.taskId as string)); return HttpResponse.json({ code: 0, message: 'success', data: { participants: task?.participants || [] } }); }),
    http.get('/summary/api/v1/summary-templates', async () => HttpResponse.json({ code: 0, message: 'success', data: { templates: [{ id: 'project_progress', label: '汇总项目进展', icon: 'FileText', description: 'desc', type: 'parameterized' as const, pattern: '总结 {project_name} 的项目进展', placeholders: [{ key: 'project_name', label: '项目名称', position: [3, 9] }] }, { id: 'weekly_report', label: '总结团队周报', icon: 'Calendar', description: 'desc2', type: 'fixed' as const, pattern: '总结每周的工作周报' }] as TopicTemplate[] } })),
    http.get('/summary/api/v1/summary-infer', async ({ request }) => { const topic = new URL(request.url).searchParams.get('topic') || ''; return HttpResponse.json({ code: 0, message: 'success', data: { suggested_mode: topic.includes('团队') ? 2 : 1, suggested_sources: [], suggested_time_range: null } }); }),
    http.post('/summary/api/v1/summary-schedules', async ({ request }) => { const body = await request.json() as any; const id = mockSchedules.size + 1; const schedule: ScheduleItem = { schedule_id: id, title: body.title, summary_mode: body.summary_mode, cron_expr: body.cron_expr, interval_days: body.interval_days, interval_months: body.interval_months, day_of_week: body.day_of_week, day_of_month: body.day_of_month, run_time: body.run_time, time_range_type: body.time_range_type, sources: body.sources, participants: body.participants || [], is_active: true, next_run_at: new Date(Date.now() + 86400000).toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; mockSchedules.set(id, schedule); return HttpResponse.json({ code: 0, message: 'success', data: schedule }); }),
    http.get('/summary/api/v1/summary-schedules', async () => HttpResponse.json({ code: 0, message: 'success', data: Array.from(mockSchedules.values()) })),
    http.get('/summary/api/v1/summary-schedules/:scheduleId', ({ params }) => { const s = mockSchedules.get(parseInt(params.scheduleId as string)); return s ? HttpResponse.json({ code: 0, message: 'success', data: s }) : HttpResponse.json({ code: 404, message: 'Not found', data: null }, { status: 404 }); }),
    http.put('/summary/api/v1/summary-schedules/:scheduleId', async ({ params, request }) => { const s = mockSchedules.get(parseInt(params.scheduleId as string)); if (s) { Object.assign(s, await request.json(), { updated_at: new Date().toISOString() }); mockSchedules.set(s.schedule_id, s); } return HttpResponse.json({ code: 0, message: 'success', data: s }); }),
    http.delete('/summary/api/v1/summary-schedules/:scheduleId', ({ params }) => { mockSchedules.delete(parseInt(params.scheduleId as string)); return HttpResponse.json({ code: 0, message: 'success', data: null }); }),
    http.put('/summary/api/v1/summary-schedules/:scheduleId/toggle', async ({ params, request }) => { const s = mockSchedules.get(parseInt(params.scheduleId as string)); if (s) { s.is_active = (await request.json() as any).is_active; s.updated_at = new Date().toISOString(); } return HttpResponse.json({ code: 0, message: 'success', data: s }); }),
    http.post('/summary/api/v1/summary-schedules/:scheduleId/confirm', async () => HttpResponse.json({ code: 0, message: 'success', data: null })),
    http.get('/summary/api/v1/summary-chat-candidates', async ({ request }) => { const keyword = new URL(request.url).searchParams.get('keyword') || ''; const candidates: ChatCandidate[] = [{ chat_id: 'group-123', chat_type: 'group', name: '项目组', member_count: 10 }, { chat_id: 'thread-456', chat_type: 'thread', name: '技术讨论', member_count: 5 }, { chat_id: 'direct-789', chat_type: 'direct', name: '张三', member_count: null }].filter((c) => !keyword || c.name.includes(keyword)); return HttpResponse.json({ code: 0, message: 'success', data: candidates }); }),
    http.get('/summary/api/v1/summary-member-candidates', async ({ request }) => { const keyword = new URL(request.url).searchParams.get('keyword') || ''; const candidates: MemberCandidate[] = [{ user_id: 'user-1', name: '张三', avatar: '', department: '技术部' }, { user_id: 'user-2', name: '李四', avatar: '', department: '产品部' }].filter((c) => !keyword || c.name.includes(keyword)); return HttpResponse.json({ code: 0, message: 'success', data: candidates }); }),
];
