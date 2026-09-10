import { describe, expect, it } from "vitest";
import { summaryListActions } from "./listActions";
import { createSummaryDetailAction, SummaryDetailActionGate } from "./detailAction";
import { listContentActionsFixture } from "../../__tests__/formalContentFixtures";
import type { SummaryListItem } from "../../types/summary";

const task = (trigger_type: number): SummaryListItem => ({
  task_id: 12, task_no: "summary", title: "Summary", trigger_type, status: 3, summary_mode: 2,
  time_range_start: "", time_range_end: "", sources: [], total_msg_count: 0,
  origin_channel_id: "", origin_channel_type: 0, created_at: "", completed_at: null,
  content_actions: listContentActionsFixture(),
});

describe("engine-neutral list capabilities", () => {
  it("uses identical actions for historical engines and does not use reference access", () => {
    const agent = { ...task(3), referenceable: false };
    expect(summaryListActions(agent)).toEqual(summaryListActions(task(1)));
    // 重新生成 now follows can_refine (config-independent): the entry appears for
    // both configured and unconfigured summaries; the modal greys 全部重新生成 when
    // the configuration is still incomplete.
    expect(summaryListActions(agent)).toMatchObject({ refine: true, edit: true, regenerate: true, configure: true });
  });
  it("never revives legacy writes for a managed task or failed projection", () => {
    expect(summaryListActions({ ...task(1), content_protocol_version: 1, content_actions: undefined })).toMatchObject({ mode: "unavailable", refine: false, edit: false });
    const item = task(3);
    item.content_actions!.mode = "unavailable";
    expect(summaryListActions(item)).toMatchObject({ mode: "unavailable", refine: false });
  });
  it("uses runtime capability booleans, not truthy malformed data", () => {
    const item = task(1);
    Object.assign(item.content_actions!.capabilities, { can_refine: "true", can_edit: 1 });
    expect(summaryListActions(item)).toMatchObject({ refine: false, edit: false });
  });
  it("shows active run cancellation even while old content remains completed", () => {
    const item = task(3);
    item.content_actions!.active_generation = { generation_id: "run", status: "running", can_cancel: true };
    Object.assign(item.content_actions!.capabilities, { can_refine: false, can_edit: false });
    expect(summaryListActions(item)).toMatchObject({ refine: false, edit: false, cancel: true });
  });
});

describe("one-shot detail intent", () => {
  it("waits for exact target readiness, then opens only once", () => {
    const gate = new SummaryDetailActionGate();
    const request = createSummaryDetailAction(12, "s", "refine", "content");
    const context = { taskId: 12, spaceId: "s", ready: false, contentId: "content" };
    expect(gate.take(request, context)).toBeUndefined();
    expect(gate.take(request, { ...context, ready: true })).toBe("refine");
    expect(gate.take(request, { ...context, ready: true })).toBeUndefined();
  });
  it("discards an intent on Space change and refuses a different content target", () => {
    const gate = new SummaryDetailActionGate();
    const request = createSummaryDetailAction(12, "s", "cancel", "content");
    expect(gate.take(request, { taskId: 12, spaceId: "other", ready: true })).toBeUndefined();
    expect(gate.take(request, { taskId: 12, spaceId: "s", ready: true, contentId: "content" })).toBeUndefined();
    const next = createSummaryDetailAction(12, "s", "edit", "content");
    expect(gate.take(next, { taskId: 12, spaceId: "s", ready: true, contentId: "someone-elses-content" })).toBeUndefined();
  });
});
