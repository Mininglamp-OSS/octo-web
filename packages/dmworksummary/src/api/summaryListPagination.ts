import { listSummaries } from "./summaryApi";
import type { ListSummariesParams, ListSummariesResponse, SummaryListItem } from "../types/summary";

// ListSummaries resets page_size > 100 to 20 rather than clamping it.
const MAX_PAGE_SIZE = 100;
const MAX_PREFIX_ATTEMPTS = 3;

export class SummaryPaginationDriftError extends Error {
    constructor() {
        super("Summary pagination changed during refresh");
        this.name = "SummaryPaginationDriftError";
    }
}

export async function fetchSummaryListPrefix(
    params: ListSummariesParams,
    limit: number,
    isCurrent: () => boolean,
): Promise<ListSummariesResponse | undefined> {
    const pageSize = Math.min(limit, MAX_PAGE_SIZE);
    let previous: ListSummariesResponse | undefined;

    for (let attempt = 0; attempt < MAX_PREFIX_ATTEMPTS; attempt += 1) {
        const items: SummaryListItem[] = [];
        const ids = new Set<number>();
        let total: number | undefined;
        let snapshot: ListSummariesResponse | undefined;
        let page = 1;

        while (isCurrent()) {
            const response = await listSummaries({ ...params, page, page_size: pageSize });
            if (!isCurrent()) return;
            total ??= response.total;
            const expected = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
            if (response.total !== total || response.items.length !== expected) break;
            for (const item of response.items) {
                if (ids.has(item.task_id)) break;
                ids.add(item.task_id);
                items.push(item);
            }
            // Never turn overlapping offset pages into a shorter "complete" prefix.
            if (items.length !== Math.min(page * pageSize, total)) break;
            if (items.length >= Math.min(limit, total)) {
                snapshot = { ...response, items: items.slice(0, limit) };
                break;
            }
            page += 1;
        }
        if (!isCurrent()) return;

        if (snapshot && (
            page === 1 ||
            (previous?.total === snapshot.total &&
                previous.items.length === snapshot.items.length &&
                previous.items.every((item, index) => item.task_id === snapshot.items[index].task_id))
        )) {
            return snapshot;
        }
        // Offset APIs have no snapshot token. For multi-request prefixes, require
        // two consecutive matching ID sequences, including same-total reorders.
        previous = snapshot;
    }
    throw new SummaryPaginationDriftError();
}
