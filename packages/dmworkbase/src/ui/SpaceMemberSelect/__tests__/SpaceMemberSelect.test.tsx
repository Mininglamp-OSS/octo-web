import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SpaceMemberOption } from "../../../bridge/spaceMembers/types";
import SpaceMemberSelect from "../index";

const labels = {
  searchPlaceholder: "Search members",
  loading: "Loading members",
  empty: "No members",
  noResults: "No matches",
};

const members: SpaceMemberOption[] = [
  { uid: "u-alice", name: "Alice", avatar: "alice.png" },
  { uid: "u-zhangsan", name: "张三" },
  { uid: "u-bob", name: "Bob" },
];

describe("SpaceMemberSelect", () => {
  it("filters members by pinyin and UID", () => {
    render(
      <SpaceMemberSelect members={members} labels={labels} onChange={vi.fn()} />
    );

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "zhangsan" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("张三");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "u-bob" },
    });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Bob");
  });

  it("reports the selected member through the controlled API", () => {
    const onChange = vi.fn();
    render(
      <SpaceMemberSelect
        members={members}
        selectedUid="u-alice"
        labels={labels}
        onChange={onChange}
      />
    );

    expect(screen.getByRole("option", { name: /Alice/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    fireEvent.click(screen.getByRole("option", { name: /Bob/ }));
    expect(onChange).toHaveBeenCalledWith("u-bob", members[2]);
  });

  it("renders loading, empty, no-result, and error states", () => {
    const view = render(
      <SpaceMemberSelect
        members={[]}
        labels={labels}
        state={{ isLoading: true }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(labels.loading);

    view.rerender(
      <SpaceMemberSelect members={[]} labels={labels} onChange={vi.fn()} />
    );
    expect(screen.getByText(labels.empty)).toBeInTheDocument();

    view.rerender(
      <SpaceMemberSelect members={members} labels={labels} onChange={vi.fn()} />
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "nobody" },
    });
    expect(screen.getByText(labels.noResults)).toBeInTheDocument();

    view.rerender(
      <SpaceMemberSelect
        members={members}
        labels={labels}
        state={{ error: "Unable to load" }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to load");
  });

  it("disables search and selection interactions", () => {
    const onChange = vi.fn();
    render(
      <SpaceMemberSelect
        members={members}
        labels={labels}
        isDisabled
        onChange={onChange}
      />
    );

    expect(screen.getByRole("textbox")).toBeDisabled();
    const option = screen.getByRole("option", { name: /Alice/ });
    expect(option).toBeDisabled();
    fireEvent.click(option);
    expect(onChange).not.toHaveBeenCalled();
  });
});
