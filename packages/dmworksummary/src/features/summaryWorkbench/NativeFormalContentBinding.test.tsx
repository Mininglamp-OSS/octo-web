import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NativeFormalContentBinding } from "./NativeFormalContentBinding";
import { formalCatalogFixture } from "../../__tests__/formalContentFixtures";

const loadContents = vi.hoisted(() => vi.fn());
vi.mock("./useCurrentSummarySpaceId", () => ({ default: () => "space-a" }));
vi.mock("../../Service/SummaryWorkbenchService", () => ({ default: { formalContents: { loadContents } } }));

describe("native detail headless binding", () => {
  beforeEach(() => { loadContents.mockReset(); });
  it("publishes formal state without rendering a replacement page and stays stable on parent renders", async () => {
    loadContents.mockResolvedValue(formalCatalogFixture());
    const onChange = vi.fn();
    const { container, rerender } = render(<NativeFormalContentBinding taskId={12} managed onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" })));
    const count = onChange.mock.calls.length;
    rerender(<NativeFormalContentBinding taskId={12} managed onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(count);
    expect(container).toBeEmptyDOMElement();
  });
  it("fails closed for managed tasks while retaining a retry action", async () => {
    loadContents.mockRejectedValueOnce({ http_status: 404 }).mockResolvedValue(formalCatalogFixture());
    const onChange = vi.fn();
    render(<NativeFormalContentBinding taskId={12} managed onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "error" })));
    act(() => onChange.mock.lastCall![0].retry());
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "ready" })));
    expect(onChange.mock.calls.some(([binding]) => binding.status === "legacy")).toBe(false);
  });
  it("retains legacy behavior only outside rollout", async () => {
    loadContents.mockRejectedValue({ status: 404 });
    const onChange = vi.fn();
    render(<NativeFormalContentBinding taskId={12} managed={false} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "legacy" })));
  });
  it("does not publish a previous task's late response", async () => {
    let finish: (value: unknown) => void = () => {};
    loadContents.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockRejectedValue({ status: 404 });
    const onChange = vi.fn();
    const { rerender } = render(<NativeFormalContentBinding taskId={12} managed={false} onChange={onChange} />);
    rerender(<NativeFormalContentBinding taskId={13} managed={false} onChange={onChange} />);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 13, status: "legacy" })));
    await act(async () => finish(formalCatalogFixture()));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ taskId: 13, status: "legacy" }));
  });
});
