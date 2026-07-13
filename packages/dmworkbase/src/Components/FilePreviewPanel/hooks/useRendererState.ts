import { useCallback, useEffect, useRef, useState } from "react";

export type RenderStatus = "idle" | "loading" | "ready" | "error";

export interface RenderState {
  status: RenderStatus;
  error: string | null;
}

export interface UseRendererStateResult extends RenderState {
  setError: (msg: string | null) => void;
  setLoading: () => void;
  setReady: () => void;
  reset: () => void;
}

/**
 * 管理 Office 渲染器的生命周期状态机：
 * idle → loading → ready | error
 * 每次切换文件 / 重试时调 reset() 回到 loading。
 */
export function useRendererState(): UseRendererStateResult {
  const [status, setStatus] = useState<RenderStatus>("loading");
  const [error, setErrorVal] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const setLoading = useCallback(() => {
    if (cancelledRef.current) return;
    setStatus("loading");
    setErrorVal(null);
  }, []);

  const setReady = useCallback(() => {
    if (cancelledRef.current) return;
    setStatus("ready");
  }, []);

  const setError = useCallback((msg: string | null) => {
    if (cancelledRef.current) return;
    setErrorVal(msg);
    setStatus(msg ? "error" : "loading");
  }, []);

  const reset = useCallback(() => {
    if (cancelledRef.current) return;
    setStatus("loading");
    setErrorVal(null);
  }, []);

  return { status, error, setError, setLoading, setReady, reset };
}

export default useRendererState;
