import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FormalContentEntry } from "./FormalContentEntry";
import { formalCatalogFixture } from "../../__tests__/formalContentFixtures";

const loadContents = vi.hoisted(() => vi.fn());
vi.mock("./useCurrentSummarySpaceId", () => ({ default: () => "space-a" }));
vi.mock("../../Service/SummaryWorkbenchService", () => ({ default: { formalContents: { loadContents } } }));
vi.mock("./FormalContentFeature", () => ({ default: () => <p>Formal feature</p> }));
vi.mock("@octo/base", async (importOriginal) => ({
  ...await importOriginal<typeof import("@octo/base")>(),
  WKButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

describe("formal detail entry", () => {
  beforeEach(() => { loadContents.mockReset(); });
  const legacy = () => <button>Legacy mutation</button>;

  it("only falls back for an unmodified task outside the execution rollout", async () => {
    loadContents.mockRejectedValue({ status: 404 });
    render(<FormalContentEntry taskId={12} title="Summary" managed={false} renderLegacy={legacy} />);
    expect(await screen.findByRole("button", { name: "Legacy mutation" })).toBeInTheDocument();
  });
  it("never restores legacy write controls for a managed task after read failure", async () => {
    loadContents.mockRejectedValueOnce({ status: 404 }).mockResolvedValue(formalCatalogFixture());
    render(<FormalContentEntry taskId={12} title="Summary" managed renderLegacy={legacy} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Legacy mutation" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("Formal feature")).toBeInTheDocument());
  });
  it("uses server capabilities, without relying on a creation-engine label", async () => {
    loadContents.mockResolvedValue(formalCatalogFixture());
    render(<FormalContentEntry taskId={12} title="Summary" managed={false} renderLegacy={legacy} />);
    expect(await screen.findByText("Formal feature")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Legacy mutation" })).not.toBeInTheDocument();
  });
});
