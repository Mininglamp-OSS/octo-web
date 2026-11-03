import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { batchStatus, getSummaryDetail, regenerateSummary } from "../../api/summaryApi";
import { TaskStatus, type SummaryDetail } from "../../types/summary";
import { useWorkflowTaskStatus } from "./useWorkflowTaskStatus";

vi.mock("../../api/summaryApi", () => ({
  batchStatus: vi.fn(), getSummaryDetail: vi.fn(), regenerateSummary: vi.fn(),
}));

describe("workbench workflow recovery", () => {
  it.each(["timeout", "quota"])("recovers a %s failure on the original task", async kind => {
    vi.resetAllMocks();
    const taskId = 17;
    let status: typeof TaskStatus.FAILED | typeof TaskStatus.COMPLETED = TaskStatus.FAILED;
    vi.mocked(batchStatus).mockImplementation(async () => [{ id: taskId, status, progress: 0, updated_at: "" }]);
    vi.mocked(getSummaryDetail).mockResolvedValue({
      status, creator_id: "member", failure_code: kind === "quota" ? "gateway_quota" : "",
      error_message: kind,
    } as SummaryDetail);
    vi.mocked(regenerateSummary).mockImplementation(async () => {
      status = TaskStatus.COMPLETED;
      return { task_id: taskId };
    });
    const { result } = renderHook(() => useWorkflowTaskStatus(taskId, "member"));
    await waitFor(() => expect(result.current.current?.status).toBe(TaskStatus.FAILED));
    await act(() => Promise.all([result.current.retry(), result.current.retry()]).then(() => {}));
    if (kind === "quota") {
      expect(result.current.current?.canRetry).toBe(false);
      expect(regenerateSummary).not.toHaveBeenCalled();
    } else {
      expect(regenerateSummary).toHaveBeenCalledTimes(1);
      expect(regenerateSummary).toHaveBeenCalledWith(taskId, undefined, TaskStatus.FAILED);
      await waitFor(() => expect(result.current.current?.status).toBe(TaskStatus.COMPLETED));
    }
  });
});
