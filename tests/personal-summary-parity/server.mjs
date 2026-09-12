// Deterministic HTTP/SSE fixture for the actual list/detail/editor components.
// No browser globals, credentials or production endpoints are modified.
const now = "2026-09-11T09:00:00+08:00";
const body = "## 项目进展\n\n已完成需求梳理和接口联调。\n\n## 下一步\n\n验证重新生成、编辑和定时更新。";
const makeTask = (id, incomplete = false, trigger = 3) => ({
    task_id: id, task_no: `PARITY-${id}`, title: incomplete ? "待补齐配置的个人总结" : trigger === 1 ? "工作流个人总结" : "项目进展总结",
    topic: "总结项目进展，按已完成、风险和下一步整理。", generation_requirement: incomplete ? "" : "总结项目进展，按已完成、风险和下一步整理。",
    summary_mode: 2, trigger_type: trigger, status: 3, creator_id: "owner", creator_name: "测试用户",
    time_range_start: "2026-09-01T00:00:00Z", time_range_end: incomplete ? "2026-09-01T00:00:00Z" : "2026-09-07T23:59:59Z",
    sources: incomplete ? [] : [{ source_type: 1, source_id: "chat-1", source_name: "项目讨论群" }],
    participants: [{ user_id: "owner", user_name: "测试用户", status: 1 }], result: null, error_message: null,
    origin_channel_id: "", origin_channel_type: 0, created_at: now, updated_at: now, referenceable: true,
    permissions: { can_edit: true, can_edit_personal: true, can_schedule: true }, schedule_id: null,
});
const tasks = [makeTask(1), makeTask(2, true), makeTask(3, false, 1)];
const personal = new Map(tasks.map(t => [t.task_id, {
    id: t.task_id, task_id: t.task_id, user_id: "owner", content: body, citations: [], version: 1,
    worker_status: 2, workflow_stage: "generate_summary", generated_at: now, submitted_at: now,
}]));
const versions = new Map(tasks.map(t => [t.task_id, [{ version: 1, result_id: t.task_id, version_id: t.task_id, operation_type: "generate", content: body, generated_at: now }]]));
const subscribers = new Map();
const stages = ["understand_question", "find_relevant_chats", "filter_useful_content", "analyze_chat_content", "generate_summary"];
function emit(id, type, data = {}) {
    for (const res of subscribers.get(id) || []) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, task_id: id, scope: "personal", ...data })}\n\n`);
}
function begin(task) {
    const pr = personal.get(task.task_id);
    task.status = 0;
    Object.assign(pr, { content: "", worker_status: 0, workflow_stage: stages[0] });
    stages.forEach((stage, i) => setTimeout(() => {
        task.status = 2;
        Object.assign(pr, { worker_status: 1, workflow_stage: stage });
        emit(task.task_id, "stage", { stage });
    }, 800 + i * 2200));
    const next = "## 重新生成的项目进展\n\n已复用 Workflow 获取聊天内容，并整理进展。\n\n## 风险和下一步\n\n继续验证流式输出、版本历史和个人总结菜单。";
    let offset = 0;
    setTimeout(() => {
        const timer = setInterval(() => {
            const delta = next.slice(offset, offset + 5);
            offset += 5;
            emit(task.task_id, "delta", { delta, content: next.slice(0, offset) });
            if (offset >= next.length) {
                clearInterval(timer);
                task.status = 3;
                Object.assign(pr, { content: next, worker_status: 2, version: pr.version + 1, generated_at: now });
                versions.get(task.task_id).unshift({ version: pr.version, result_id: pr.version + 10, operation_type: "regenerate", content: next, generated_at: now });
                emit(task.task_id, "done", { content: next });
            }
        }, 1000);
    }, 11000);
}
export function parityFixture() {
    return {
        name: "personal-summary-parity-fixture",
        configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
                const url = new URL(req.url, "http://localhost");
                if (!url.pathname.startsWith("/summary/api/") && !url.pathname.startsWith("/api/")) return next();
                const path = url.pathname.replace(/^\/summary\/api\/v1/, "").replace(/^\/api\/v1/, "");
                const send = (data) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ code: 0, data })); };
                let input = {};
                if (req.method !== "GET") {
                    let raw = ""; for await (const chunk of req) raw += chunk;
                    try { input = JSON.parse(raw || "{}"); } catch {}
                }
                if (path === "/summaries") return send({ items: tasks, total: tasks.length, page: 1, page_size: 20, pending_count: 0, attention_count: 0 });
                if (path === "/summaries/batch-status") return send({ tasks: tasks.map(t => ({ id: t.task_id, status: t.status, progress: t.status === 3 ? 100 : 30, updated_at: now })) });
                if (path === "/summaries/attention") return send({ attention_count: 0, pending_count: 0, unread_count: 0 });
                if (path.includes("capabilities")) return send({ enabled: false });
                if (path === "/summary-chat-candidates") return send([{ chat_id: "chat-1", chat_type: "group", name: "项目讨论群", member_count: 5 }]);
                const match = path.match(/^\/summaries\/(\d+)(.*)$/);
                if (!match) return send([]);
                const id = Number(match[1]), action = match[2], task = tasks.find(t => t.task_id === id), pr = personal.get(id);
                if (!task) { res.statusCode = 404; return send(null); }
                if (action === "/stream") {
                    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }); res.write(": ready\n\n");
                    if (!subscribers.has(id)) subscribers.set(id, new Set());
                    subscribers.get(id).add(res);
                    res.on("close", () => subscribers.get(id).delete(res));
                    return;
                }
                if (action === "/personal") return send(pr);
                if (action === "/members") return send({ members: [{ user_id: "owner", user_name: "测试用户", status: "completed", content: pr.content, personal_result: pr }] });
                if (action === "/personal-versions" || action === "/versions") return send({ versions: versions.get(id), keep_limit: 10 });
                if (action === "/regenerate" || action === "/generation-config") {
                    task.generation_requirement = input.topic || task.generation_requirement;
                    if (input.sources) task.sources = input.sources;
                    if (input.time_range) Object.assign(task, { time_range_start: input.time_range.start, time_range_end: input.time_range.end });
                    if (action === "/regenerate") begin(task);
                    return send({ task_id: id, status: task.status });
                }
                if (action === "/personal-edit") {
                    pr.content = input.content; pr.version++;
                    versions.get(id).unshift({ version: pr.version, result_id: pr.version + 10, operation_type: "edit", content: pr.content, generated_at: now });
                    return send({ edited_at: now });
                }
                if (action === "/personal-refine/stream") {
                    res.writeHead(200, { "Content-Type": "text/event-stream" });
                    const content = "## 按意见调整\n\n已保留原有证据，并根据意见精简内容。";
                    res.write(`event: delta\ndata: ${JSON.stringify({ type: "delta", delta: content, content })}\n\n`);
                    pr.content = content; pr.version++;
                    res.end(`event: done\ndata: ${JSON.stringify({ type: "done", ...pr })}\n\n`);
                    return;
                }
                if (action === "/read") return send({ needs_attention: false });
                return send(task);
            });
        },
    };
}
