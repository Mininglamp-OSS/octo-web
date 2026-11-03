import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MineTable, { type MineRow } from "../MineTable";

const row: MineRow = {
  id: "expert-1",
  type: "expert",
  icon: null,
  name: "blocked expert",
  status: "published",
  dependencyIssues: [
    { targetPluginId: "skill-1", targetName: "合同清单", reason: "delisted" },
    { targetPluginId: "skill-2", reason: "future_reason" },
  ],
};

describe("MineTable dependency warning", () => {
  it("puts actionable dependency warnings in the status cell without exposing reference IDs in the name", () => {
    const edit = vi.fn();
    render(<MineTable rows={[{ ...row, onEdit: edit }]} />);
    const warning = screen.getByRole("button", { name: /依赖失效|skillMarket.publication.invalidDependencies/ });
    expect(warning.closest('[role="cell"]')).toHaveTextContent(/已发布|published/);
    expect(warning).toHaveAttribute("title", expect.stringContaining("合同清单"));
    expect(screen.getByRole("button", { name: row.name })).not.toHaveTextContent("skill-2");
    fireEvent.click(warning);
    expect(edit).toHaveBeenCalledOnce();
  });
});
