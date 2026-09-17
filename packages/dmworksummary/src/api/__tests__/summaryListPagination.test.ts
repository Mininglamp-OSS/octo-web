import { beforeEach, describe, expect, it, vi } from "vitest";
import { listSummaries } from "../summaryApi";
import { fetchSummaryListPrefix, SummaryPaginationDriftError } from "../summaryListPagination";
import type { ListSummariesResponse, SummaryListItem } from "../../types/summary";

vi.mock("../summaryApi", () => ({ listSummaries: vi.fn() }));

const rows = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
    task_id: start + index,
} as SummaryListItem));
const response = (items: SummaryListItem[], total: number): ListSummariesResponse => ({
    items, total, attention_count: 0, unread_count: 0, pending_invitation_count: 0,
});
const ids = (items: SummaryListItem[]) => items.map((item) => item.task_id);

describe("fetchSummaryListPrefix", () => {
    beforeEach(() => vi.resetAllMocks());

    it("fetches a prefix within the server limit in one request", async () => {
        vi.mocked(listSummaries).mockResolvedValue(response(rows(1, 40), 60));
        const result = await fetchSummaryListPrefix({ keyword: "query", origin_channel_id: "channel" }, 40, () => true);
        expect(listSummaries).toHaveBeenCalledExactlyOnceWith({
            page: 1, page_size: 40, keyword: "query", origin_channel_id: "channel",
        });
        expect(ids(result!.items)).toEqual(ids(rows(1, 40)));
    });

    it.each([120, 150])("verifies a %i-row prefix without exceeding the 100-row server limit", async (limit) => {
        vi.mocked(listSummaries).mockImplementation(async ({ page, page_size }) => {
            expect(page_size).toBe(100);
            return response(rows((page! - 1) * page_size! + 1, 100), 240);
        });
        const result = await fetchSummaryListPrefix({}, limit, () => true);
        expect(listSummaries).toHaveBeenCalledTimes(4);
        expect(vi.mocked(listSummaries).mock.calls.map(([params]) => params.page)).toEqual([1, 2, 1, 2]);
        expect(ids(result!.items)).toEqual(ids(rows(1, limit)));
    });

    it("restarts overlapping pages instead of committing a deduped gap", async () => {
        vi.mocked(listSummaries)
            .mockResolvedValueOnce(response(rows(1, 100), 160))
            .mockResolvedValueOnce(response(rows(100, 60), 160))
            .mockImplementation(async ({ page, page_size }) =>
                response(rows((page! - 1) * page_size! + 1, page === 1 ? 100 : 60), 160));
        const result = await fetchSummaryListPrefix({}, 160, () => true);
        expect(listSummaries).toHaveBeenCalledTimes(6);
        expect(ids(result!.items)).toEqual(ids(rows(1, 160)));
        expect(new Set(ids(result!.items)).size).toBe(160);
    });

    it("restarts when deletion changes the total between requests", async () => {
        vi.mocked(listSummaries)
            .mockResolvedValueOnce(response(rows(1, 100), 160))
            .mockResolvedValueOnce(response(rows(102, 59), 159))
            .mockImplementation(async ({ page, page_size }) =>
                response(rows((page! - 1) * page_size! + 2, page === 1 ? 100 : 59), 159));
        const result = await fetchSummaryListPrefix({}, 160, () => true);
        expect(result!.total).toBe(159);
        expect(ids(result!.items)).toEqual(ids(rows(2, 159)));
    });

    it("rejects a same-total mixed ordering until two consecutive prefixes agree", async () => {
        // Moving task 1 to the end after page 1 skips task 101 without a
        // duplicate or a total change. A second complete ID sequence detects it.
        const reordered = [...rows(2, 239), ...rows(1, 1)];
        vi.mocked(listSummaries)
            .mockResolvedValueOnce(response(rows(1, 100), 240))
            .mockResolvedValueOnce(response(rows(102, 100), 240))
            .mockImplementation(async ({ page, page_size }) =>
                response(reordered.slice((page! - 1) * page_size!, page! * page_size!), 240));
        const result = await fetchSummaryListPrefix({}, 120, () => true);
        expect(listSummaries).toHaveBeenCalledTimes(6);
        expect(ids(result!.items)).toEqual(ids(reordered.slice(0, 120)));
    });

    it("bounds retries when every response has duplicate IDs", async () => {
        vi.mocked(listSummaries).mockResolvedValue(response([...rows(1, 19), ...rows(1, 1)], 60));
        await expect(fetchSummaryListPrefix({}, 20, () => true)).rejects.toBeInstanceOf(SummaryPaginationDriftError);
        expect(listSummaries).toHaveBeenCalledTimes(3);
    });

    it("rejects short pages instead of advancing the server offset", async () => {
        vi.mocked(listSummaries).mockResolvedValue(response(rows(1, 39), 60));
        await expect(fetchSummaryListPrefix({}, 40, () => true)).rejects.toThrow("pagination changed");
        expect(listSummaries).toHaveBeenCalledTimes(3);
    });

    it("returns an empty authoritative prefix without retrying", async () => {
        vi.mocked(listSummaries).mockResolvedValue(response([], 0));
        const result = await fetchSummaryListPrefix({}, 120, () => true);
        expect(result!.items).toEqual([]);
        expect(result!.total).toBe(0);
        expect(listSummaries).toHaveBeenCalledTimes(1);
    });

    it("stops reading as soon as the caller is superseded", async () => {
        let current = true;
        vi.mocked(listSummaries).mockImplementation(async () => {
            current = false;
            return response(rows(1, 100), 240);
        });
        expect(await fetchSummaryListPrefix({}, 120, () => current)).toBeUndefined();
        expect(listSummaries).toHaveBeenCalledTimes(1);
    });

    it("propagates failures without retrying the network request", async () => {
        vi.mocked(listSummaries).mockRejectedValue(new Error("offline"));
        await expect(fetchSummaryListPrefix({}, 120, () => true)).rejects.toThrow("offline");
        expect(listSummaries).toHaveBeenCalledTimes(1);
    });
});
