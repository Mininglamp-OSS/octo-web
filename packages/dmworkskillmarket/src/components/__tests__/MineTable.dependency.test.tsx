import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("renders known and unknown reasons without throwing", () => {
    render(<MineTable rows={[row]} />);
    expect(screen.getByText(/合同清单/)).toBeInTheDocument();
    expect(screen.getByText(/skill-2/)).toBeInTheDocument();
  });
});
