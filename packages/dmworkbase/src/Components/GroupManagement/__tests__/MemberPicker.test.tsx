// @vitest-environment jsdom

import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Channel } from "wukongimjssdk";

const hoisted = vi.hoisted(() => ({
  subscribers: [
    { uid: "user-1", name: "Alice", avatar: "alice.png" },
    { uid: "user-2", name: "Bob", avatar: "bob.png" },
  ],
  search: vi.fn(),
  loadMoreSubscribersIfNeed: vi.fn(),
}));

vi.mock("../../../Service/Provider", () => ({
  default: ({
    render: renderView,
  }: {
    render: (vm: unknown) => React.ReactNode;
  }) =>
    renderView({
      subscribers: hoisted.subscribers,
      search: hoisted.search,
      loadMoreSubscribersIfNeed: hoisted.loadMoreSubscribersIfNeed,
    }),
  ProviderListener: class {},
}));

vi.mock("../../WKAvatar", () => ({
  default: ({ src }: { src?: string }) => <img src={src} alt="" />,
}));

vi.mock("../../Subscribers/list_vm", () => ({
  SubscriberListVM: class {},
}));

import { GroupManagementMemberPicker } from "../MemberPicker";

describe("GroupManagementMemberPicker", () => {
  beforeEach(() => {
    hoisted.search.mockReset();
    hoisted.loadMoreSubscribersIfNeed.mockReset();
  });

  it("uses square checkboxes and keeps independent multi-selection", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <GroupManagementMemberPicker
        channel={new Channel("group-1", 2)}
        filter={() => true}
        labels={{
          searchPlaceholder: "搜索成员",
          empty: "暂无成员",
          emptySearch: "没有匹配成员",
        }}
        onSelect={onSelect}
      />
    );

    const alice = screen.getByRole("checkbox", { name: "Alice" });
    const bob = screen.getByRole("checkbox", { name: "Bob" });

    expect(alice).toHaveAttribute("aria-checked", "false");
    expect(bob).toHaveAttribute("aria-checked", "false");
    expect(container.querySelector(".wk-group-member-picker-check")).toBeNull();

    fireEvent.click(alice);
    expect(alice).toHaveAttribute("aria-checked", "true");
    expect(onSelect).toHaveBeenLastCalledWith([hoisted.subscribers[0]]);

    fireEvent.click(bob);
    expect(alice).toHaveAttribute("aria-checked", "true");
    expect(bob).toHaveAttribute("aria-checked", "true");
    expect(onSelect).toHaveBeenLastCalledWith([
      hoisted.subscribers[1],
      hoisted.subscribers[0],
    ]);

    fireEvent.keyDown(alice, { key: " " });
    expect(alice).toHaveAttribute("aria-checked", "false");
    expect(bob).toHaveAttribute("aria-checked", "true");
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});
