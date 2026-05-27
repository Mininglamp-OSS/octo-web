import { useState, useCallback, useEffect } from "react";
import { t } from "@octo/base";
import * as api from "../api/summaryApi";
import type { SummaryDetail } from "../types/summary";

interface UseSummaryDetailReturn {
    detail: SummaryDetail | null;
    loading: boolean;
    error: string | null;
    refresh: () => void;
    regenerate: () => Promise<void>;
    cancel: () => Promise<void>;
}

export function useSummaryDetail(taskId: number | null): UseSummaryDetailReturn {
    const [detail, setDetail] = useState<SummaryDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const fetchDetail = useCallback(async () => {
        if (taskId == null) return;
        setLoading(true);
        setError(null);
        try {
            const data = await api.getSummaryDetail(taskId);
            setDetail(data);
        } catch (err: any) {
            setError(err.message || t("summary.common.loadingFailed"));
        } finally {
            setLoading(false);
        }
    }, [taskId, refreshKey]);

    useEffect(() => {
        fetchDetail();
    }, [fetchDetail]);

    const refresh = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);

    const regenerate = useCallback(async () => {
        if (taskId == null) return;
        await api.regenerateSummary(taskId);
        refresh();
    }, [taskId, refresh]);

    const cancel = useCallback(async () => {
        if (taskId == null) return;
        await api.cancelSummary(taskId);
        refresh();
    }, [taskId, refresh]);

    return { detail, loading, error, refresh, regenerate, cancel };
}
