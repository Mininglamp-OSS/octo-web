import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/summaryApi";
import ScheduleListPage from "../ScheduleListPage";
import WKApp from "@octo/base/src/App";
import { Popconfirm, Toast } from "@douyinfe/semi-ui";

vi.mock("../../api/summaryApi");
vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => null,
    Tag: () => null,
    Banner: () => null,
    Modal: () => null,
    Popconfirm: () => null,
    Toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../../components/ScheduleForm", () => ({ default: () => null }));
vi.mock("@octo/base", async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, WKButton: () => null,
        default: { ...actual.default, routeLeft: { popToRoot: vi.fn() } } };
});

function makePage(onBack?: () => void) {
    const page = new ScheduleListPage({ onBack });
    (page as any).context = { t: (key: string) => key };
    (page as any).setState = function (patch: any) {
        this.state = { ...this.state, ...(typeof patch === "function" ? patch(this.state) : patch) };
    };
    return page;
}

function elements(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
}

describe("ScheduleListPage.handleUpdate — V5 confirm_policy passthrough", () => {
    beforeEach(() => vi.clearAllMocks());

    it("multi-person schedule with existing confirm_policy → preserves/passes it through", async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 5 } as any);
        const page = makePage();
        page.state.editingSchedule = {
            schedule_id: 5,
            title: "Legacy",
            summary_mode: 2,
            participants: [{ user_id: "a" }, { user_id: "b" }], // 多人
            confirm_policy: 1,
        } as any;

        await page.handleUpdate({
            title: "Legacy", summary_mode: 2, cron_expr: "", interval_days: 7,
            interval_months: 0, day_of_week: 0, day_of_month: 0,
            run_time: "09:00", time_range_type: 2, sources: [],
        } as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            5,
            expect.objectContaining({ confirm_policy: 1 })
        );
    });

    it("multi-person schedule missing confirm_policy → defaults to 1", async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 6 } as any);
        const page = makePage();
        page.state.editingSchedule = {
            schedule_id: 6,
            title: "Legacy",
            summary_mode: 2,
            participants: [{ user_id: "a" }, { user_id: "b" }],
            // confirm_policy 缺省
        } as any;

        await page.handleUpdate({
            title: "Legacy", summary_mode: 2, cron_expr: "", interval_days: 7,
            interval_months: 0, day_of_week: 0, day_of_month: 0,
            run_time: "09:00", time_range_type: 2, sources: [],
        } as any);

        expect(api.updateSchedule).toHaveBeenCalledWith(
            6,
            expect.objectContaining({ confirm_policy: 1 })
        );
    });

    it("single-person schedule → omits confirm_policy (backend fallback)", async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 7 } as any);
        const page = makePage();
        page.state.editingSchedule = {
            schedule_id: 7,
            title: "Legacy",
            summary_mode: 2,
            participants: [{ user_id: "a" }], // 单人
        } as any;

        await page.handleUpdate({
            title: "Legacy", summary_mode: 2, cron_expr: "", interval_days: 7,
            interval_months: 0, day_of_week: 0, day_of_month: 0,
            run_time: "09:00", time_range_type: 2, sources: [],
        } as any);

        const arg = vi.mocked(api.updateSchedule).mock.calls[0][1] as any;
        expect("confirm_policy" in arg).toBe(false);
    });
});

describe("legacy schedule recovery controls", () => {
    beforeEach(() => vi.clearAllMocks());

    it("offers edit, pause, and confirmed delete without standalone creation", async () => {
        vi.mocked(api.listSchedules).mockResolvedValue([{
            schedule_id: 1, title: "Weekly", summary_mode: 2, is_active: true,
            interval_days: 7, cron_expr: "", run_time: "09:00", time_range_type: 2,
            sources: [{ source_type: 1, source_id: "group-a" }],
        }] as any);
        const page = makePage();
        await page.loadData();
        const rendered = elements(page.render());
        expect(page.state.schedules).toHaveLength(1);
        expect(rendered.some(node => node.props?.description === "summary.generation.scheduleDetailOnly")).toBe(true);
        expect(rendered.some(node => node.props?.["aria-label"] === "summary.schedule.editModalTitle")).toBe(true);
        expect(rendered.filter(node => node.props?.onConfirm)).toHaveLength(1);
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(api.toggleSchedule).not.toHaveBeenCalled();
        expect(api.deleteSchedule).not.toHaveBeenCalled();
    });

    function pageWithSchedule(active = true) {
        const page = makePage();
        page.state.schedules = [{
            schedule_id: 1, is_active: active, title: "Legacy",
            summary_mode: 2, cron_expr: "", interval_days: 7, run_time: "09:00", time_range_type: 2,
        }] as any;
        return page;
    }

    it("pauses an active legacy schedule through the existing API and removes the pause action", async () => {
        vi.mocked(api.toggleSchedule).mockResolvedValue({ is_active: false } as any);
        const page = pageWithSchedule();
        const pause = elements(page.render()).find(node => node.props?.["aria-label"] === "summary.schedule.pause");
        await pause.props.onClick();
        expect(api.toggleSchedule).toHaveBeenCalledWith(1, false);
        expect(page.state.schedules[0].is_active).toBe(false);
        expect(elements(page.render()).some(node => node.props?.["aria-label"] === "summary.schedule.pause")).toBe(false);
        await page.handleScheduleAction(1, "pause");
        expect(api.toggleSchedule).toHaveBeenCalledTimes(1);
    });

    it("resumes a paused legacy schedule and replaces the resume action with pause", async () => {
        vi.mocked(api.toggleSchedule).mockResolvedValue({ is_active: true } as any);
        const page = pageWithSchedule(false);
        const resume = elements(page.render()).find(node => node.props?.["aria-label"] === "summary.schedule.resume");

        await resume.props.onClick();

        expect(api.toggleSchedule).toHaveBeenCalledWith(1, true);
        expect(page.state.schedules[0].is_active).toBe(true);
        expect(elements(page.render()).some(node => node.props?.["aria-label"] === "summary.schedule.resume")).toBe(false);
        expect(elements(page.render()).some(node => node.props?.["aria-label"] === "summary.schedule.pause")).toBe(true);
    });

    it("refetches authoritative source labels after updating an existing schedule", async () => {
        vi.mocked(api.updateSchedule).mockResolvedValue({ schedule_id: 1 } as any);
        vi.mocked(api.listSchedules).mockResolvedValue([{
            schedule_id: 1, is_active: false, title: "Updated",
            summary_mode: 2, cron_expr: "", interval_days: 14, run_time: "10:00", time_range_type: 2,
            sources: [{ source_type: 1, source_id: "group-b", source_name: "Project group" }],
        }] as any);
        const page = pageWithSchedule(false);
        page.state.editingSchedule = page.state.schedules[0];

        await page.handleUpdate({
            title: "Updated",
            summary_mode: 2,
            cron_expr: "",
            interval_days: 14,
            interval_months: 0,
            day_of_week: 0,
            day_of_month: 0,
            run_time: "10:00",
            time_range_type: 2,
            sources: [{ source_type: 1, source_id: "group-b" }],
        });

        expect(api.updateSchedule).toHaveBeenCalledWith(1, expect.objectContaining({
            title: "Updated",
            interval_days: 14,
            run_time: "10:00",
        }));
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.listSchedules).toHaveBeenCalledOnce();
        expect(page.state.editingSchedule).toBeNull();
        expect(page.state.schedules[0]).toEqual(expect.objectContaining({ title: "Updated", interval_days: 14 }));
        expect(elements(page.render()).some(node =>
            node.props?.className === "summary-schedule-card-sources" &&
            node.props.children.includes("Project group"))).toBe(true);
    });

    it("renders an explanatory empty state without a standalone create action", () => {
        const page = makePage();
        const rendered = elements(page.render());

        expect(rendered.some(node => node.props?.className === "summary-schedule-empty")).toBe(true);
        expect(rendered.some(node => node.props?.children === "summary.schedule.empty")).toBe(true);
        expect(api.createSchedule).not.toHaveBeenCalled();
    });

    it("deletes only after confirmation, without requiring a bound summary", async () => {
        vi.mocked(api.deleteSchedule).mockResolvedValue();
        const page = pageWithSchedule(false);
        const confirm = elements(page.render()).find(node => node.type === Popconfirm);
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        await confirm.props.onConfirm();
        expect(api.deleteSchedule).toHaveBeenCalledWith(1);
        expect(page.state.schedules).toEqual([]);
        expect(api.toggleSchedule).not.toHaveBeenCalled();
    });

    it.each(["pause", "resume", "delete"] as const)("preserves the row and releases busy state when %s fails", async action => {
        const error = new Error("Permission denied");
        vi.mocked(api.toggleSchedule).mockRejectedValue(error);
        vi.mocked(api.deleteSchedule).mockRejectedValue(error);
        const page = pageWithSchedule(action !== "resume");
        await page.handleScheduleAction(1, action);
        expect(page.state.schedules).toEqual([expect.objectContaining({
            schedule_id: 1,
            is_active: action !== "resume",
            title: "Legacy",
        })]);
        expect(page.state.actionPending).toBe(false);
        expect(Toast.error).toHaveBeenCalledWith("Permission denied");
    });

    it("blocks duplicate and competing actions while a request is pending", async () => {
        let finish!: (value: any) => void;
        vi.mocked(api.toggleSchedule).mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const page = pageWithSchedule();
        const pending = page.handleScheduleAction(1, "pause");
        await page.handleScheduleAction(1, "pause");
        await page.handleScheduleAction(1, "delete");
        expect(api.toggleSchedule).toHaveBeenCalledTimes(1);
        expect(api.deleteSchedule).not.toHaveBeenCalled();
        expect(page.state.actionPending).toBe(true);
        const buttons = elements(page.render()).filter(node =>
            ["summary.schedule.pause", "summary.common.delete"].includes(node.props?.["aria-label"]));
        expect(buttons).toHaveLength(2);
        expect(buttons.every(node => node.props.disabled)).toBe(true);
        finish({ is_active: false });
        await pending;
        expect(page.state.actionPending).toBe(false);
    });

    it("returns to the embedded summary list", () => {
        const onBack = vi.fn();
        makePage(onBack).handleBack();
        expect(onBack).toHaveBeenCalledOnce();
    });

    it("preserves legacy back navigation", () => {
        const back = vi.spyOn(WKApp.routeLeft, "popToRoot");
        makePage().handleBack();
        expect(back).toHaveBeenCalledOnce();
    });
});
