import { useState, useCallback, useEffect } from "react";
import { t } from "@octo/base";
import * as api from "../api/summaryApi";
import type {
    ListSummariesParams,
    SummaryListItem,
    TaskStatusType,
} from "../types/summary";

interface UseSummaryListReturn {
    items: SummaryListItem[];
    total: number;
    page: number;
    pageSize: number;
    loading: boolean;
    error: string | null;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
    setStatusFilter: (status: TaskStatusType | undefined) => void;
    setKeyword: (keyword: string) => void;
    refresh: () => void;
    deleteSummary: (taskId: number) => Promise<void>;
}

export function useSummaryList(): UseSummaryListReturn {
    const [items, setItems] = useState<SummaryListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [statusFilter, setStatusFilter] = useState<TaskStatusType | undefined>(undefined);
    const [keyword, setKeyword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const fetchList = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params: ListSummariesParams = {
                page,
                page_size: pageSize,
                status: statusFilter,
                keyword: keyword || undefined,
            };
            const resp = await api.listSummaries(params);
            setItems(resp.items);
            setTotal(resp.total);
        } catch (err: any) {
            setError(err.message || t("summary.common.loadingFailed"));
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, statusFilter, keyword, refreshKey]);

    useEffect(() => {
        fetchList();
    }, [fetchList]);

    const refresh = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);

    const handleDelete = useCallback(async (taskId: number) => {
        await api.deleteSummary(taskId);
        refresh();
    }, [refresh]);

    return {
        items,
        total,
        page,
        pageSize,
        loading,
        error,
        setPage,
        setPageSize,
        setStatusFilter,
        setKeyword,
        refresh,
        deleteSummary: handleDelete,
    };
}
