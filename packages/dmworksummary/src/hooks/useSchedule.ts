import { useState, useCallback, useEffect } from "react";
import { t } from "@octo/base";
import * as api from "../api/summaryApi";
import type {
    ScheduleItem,
    CreateScheduleParams,
    UpdateScheduleParams,
} from "../types/summary";

interface UseScheduleReturn {
    schedules: ScheduleItem[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    create: (params: CreateScheduleParams) => Promise<void>;
    update: (id: number, params: UpdateScheduleParams) => Promise<void>;
    remove: (id: number) => Promise<void>;
    toggle: (id: number, isActive: boolean) => Promise<void>;
}

export function useSchedule(): UseScheduleReturn {
    const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    const fetchList = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.listSchedules();
            setSchedules(data);
        } catch (err: any) {
            setError(err.message || t("summary.common.loadingFailed"));
        } finally {
            setLoading(false);
        }
    }, [refreshKey]);

    useEffect(() => {
        fetchList();
    }, [fetchList]);

    const refresh = useCallback(() => {
        setRefreshKey((k) => k + 1);
    }, []);

    const create = useCallback(async (params: CreateScheduleParams) => {
        await api.createSchedule(params);
        refresh();
    }, [refresh]);

    const update = useCallback(async (id: number, params: UpdateScheduleParams) => {
        await api.updateSchedule(id, params);
        refresh();
    }, [refresh]);

    const remove = useCallback(async (id: number) => {
        await api.deleteSchedule(id);
        refresh();
    }, [refresh]);

    const toggle = useCallback(async (id: number, isActive: boolean) => {
        await api.toggleSchedule(id, isActive);
        refresh();
    }, [refresh]);

    return { schedules, loading, error, refresh, create, update, remove, toggle };
}
