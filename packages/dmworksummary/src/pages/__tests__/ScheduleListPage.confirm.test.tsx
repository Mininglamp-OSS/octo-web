import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/summaryApi";
import ScheduleListPage from "../ScheduleListPage";
import WKApp from "@octo/base/src/App";

vi.mock("../../api/summaryApi");
vi.mock("@douyinfe/semi-ui", () => ({
    Spin: () => null,
    Tag: () => null,
    Banner: () => null,
}));
vi.mock("@octo/base", async (importOriginal) => {
    const actual = await importOriginal<any>();
    return { ...actual, WKButton: () => null,
        default: { ...actual.default, routeLeft: { popToRoot: vi.fn() } } };
});

function makePage(onBack?: () => void) {
    const page = new ScheduleListPage({ onBack });
    (page as any).context = { t: (key: string) => key };
    (page as any).setState = function (patch: any) {
        this.state = { ...this.state, ...patch };
    };
    return page;
}

function elements(node: any): any[] {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children)];
}

describe("legacy schedule list is read-only", () => {
    beforeEach(() => vi.clearAllMocks());

    it("loads schedules without exposing create, edit, source, toggle, or delete controls", async () => {
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
        expect(rendered.filter(node => node.props?.onClick)).toHaveLength(1);
        expect(rendered.some(node => node.props?.onSubmit || node.props?.onChange || node.props?.onConfirm)).toBe(false);
        expect(api.createSchedule).not.toHaveBeenCalled();
        expect(api.updateSchedule).not.toHaveBeenCalled();
        expect(api.toggleSchedule).not.toHaveBeenCalled();
        expect(api.deleteSchedule).not.toHaveBeenCalled();
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
