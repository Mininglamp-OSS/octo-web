import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useFormalContent from "./useFormalContent";
import { SummaryContentService } from "../../Service/SummaryContentService";
import { formalContentFixture, formalCatalogFixture, generationConfigurationFixture, generationFixture } from "../../__tests__/formalContentFixtures";

describe("formal content controller", () => {
  it("keeps the editor's original baseline even when background reads advance the current revision", async () => {
    const initial = formalContentFixture();
    const next = { ...initial, content_revision: 2 };
    const command = vi.fn().mockRejectedValue({ status: 409 });
    const service = new SummaryContentService({ command, read: vi.fn().mockResolvedValue(formalCatalogFixture(next)) });
    const { result } = renderHook(() => useFormalContent("space-a", 12, initial, service));
    await act(async () => { await result.current.reload(); });
    await act(async () => { await result.current.edit("Draft", {
      content_id: initial.content_id, expected_current_version_id: initial.current_version!.version_id, expected_content_revision: 1,
    }); });
    expect(command.mock.calls[0][2].expected_content_revision).toBe(1);
    expect(result.current.errorKey).toBe("summary.formal.errors.conflict");
  });
  it("restores state with reads only and reuses the same idempotency key after transport failure", async () => {
    const command = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(generationFixture());
    const service = new SummaryContentService({ command, read: vi.fn().mockResolvedValue(formalCatalogFixture()) });
    const { result } = renderHook(() => useFormalContent("space-a", 12, formalContentFixture(), service));
    await act(async () => { await result.current.reload(); });
    expect(command).not.toHaveBeenCalled();
    await act(async () => { await result.current.refine("Shorter"); });
    await act(async () => { await result.current.refine("Shorter"); });
    expect(command).toHaveBeenCalledTimes(2);
    expect(command.mock.calls[0][2].idempotency_key).toBe(command.mock.calls[1][2].idempotency_key);
  });
  it("does not send a generation from a configuration-only save", async () => {
    const config = generationConfigurationFixture();
    const command = vi.fn().mockResolvedValue({ configuration: { ...config, revision: 1 }, generation: null });
    const service = new SummaryContentService({ command, read: vi.fn().mockResolvedValue(formalCatalogFixture()) });
    const { result } = renderHook(() => useFormalContent("space-a", 12, formalContentFixture(), service));
    await act(async () => { await result.current.saveConfiguration({ expected_config_revision: 0, spec: config.spec }); });
    expect(command.mock.calls[0][2]).not.toHaveProperty("generate");
    expect(result.current.noticeKey).toBe("summary.formal.saved");
  });
  it("ignores late configuration from the previous Space", async () => {
    let finish: (value: unknown) => void = () => {};
    const read = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const service = new SummaryContentService({ read });
    const { result, rerender } = renderHook(({ space }) => useFormalContent(space, 12, formalContentFixture(), service), { initialProps: { space: "space-a" } });
    let pending: Promise<boolean>;
    act(() => { pending = result.current.loadConfiguration(); });
    rerender({ space: "space-b" });
    await act(async () => { finish(generationConfigurationFixture()); await pending; });
    expect(result.current.configuration).toBeNull();
    expect(result.current.pending).toBe(false);
  });
  it("hides content after access revocation instead of retaining an actionable cache", async () => {
    const service = new SummaryContentService({ read: vi.fn().mockRejectedValue({ status: 403 }) });
    const { result } = renderHook(() => useFormalContent("space-a", 12, formalContentFixture(), service));
    await act(async () => { await result.current.reload(); });
    expect(result.current.accessLost).toBe(true);
  });
  it("retains an accepted run and disables writes when the follow-up read fails", async () => {
    const service = new SummaryContentService({
      command: vi.fn().mockResolvedValue(generationFixture()), read: vi.fn().mockRejectedValue(new Error("network")),
    });
    const { result } = renderHook(() => useFormalContent("space-a", 12, formalContentFixture(), service));
    await act(async () => { await result.current.refine("Shorter"); });
    expect(result.current.content.active_generation?.generation_id).toBe(generationFixture().generation_id);
    expect(result.current.content.capabilities.can_edit).toBe(false);
    expect(result.current.content.capabilities.can_refine).toBe(false);
    expect(result.current.errorKey).toBe("summary.formal.errors.request");
  });
  it("uses a new operation key for an explicit retry after an acknowledged failed run", async () => {
    const failed = { ...generationFixture(), status: "failed", stage: "finished" };
    const catalog = formalCatalogFixture();
    const command = vi.fn().mockResolvedValue(failed);
    const service = new SummaryContentService({ command, read: vi.fn().mockResolvedValue(catalog) });
    const { result } = renderHook(() => useFormalContent("space-a", 12, formalContentFixture(), service));
    await act(async () => { await result.current.refine("Shorter"); });
    await act(async () => { await result.current.refine("Shorter"); });
    expect(command.mock.calls[0][2].idempotency_key).not.toBe(command.mock.calls[1][2].idempotency_key);
  });
});
