import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useHtmlAttachment } from "./useHtmlAttachment";

const load = vi.hoisted(() => vi.fn());
vi.mock("./readAttachment", () => ({ loadHtmlAttachment: load }));
function Viewer({ url }: { url: string }) {
  const state = useHtmlAttachment({
    url,
    name: `${url}.html`,
    extension: "html",
  });
  return <div>{state.loading ? "loading" : state.content || state.error}</div>;
}

describe("selected attachment ownership", () => {
  it("clears old bytes and ignores cancelled results on a file switch", async () => {
    let finishSecond!: (bytes: Uint8Array) => void;
    load.mockResolvedValueOnce(new TextEncoder().encode("first document"));
    load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSecond = resolve;
        })
    );
    const view = render(<Viewer url="first" />);
    await screen.findByText("first document");
    view.rerender(<Viewer url="second" />);
    expect(screen.queryByText("first document")).not.toBeInTheDocument();
    expect(screen.getByText("loading")).toBeInTheDocument();
    const secondSignal = load.mock.calls[1][2] as AbortSignal;
    load.mockResolvedValueOnce(new TextEncoder().encode("third document"));
    view.rerender(<Viewer url="third" />);
    await screen.findByText("third document");
    expect(secondSignal.aborted).toBe(true);
    await act(async () => {
      finishSecond(new TextEncoder().encode("late second document"));
    });
    await waitFor(() =>
      expect(screen.getByText("third document")).toBeInTheDocument()
    );
    expect(screen.queryByText("late second document")).not.toBeInTheDocument();
  });
});
