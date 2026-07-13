import React, { useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import FilterSearchSelect, {
  type FilterSearchOption,
} from "../FilterSearchSelect";

// FilterSearchSelect is the select-style field the global-search filter panel
// uses for 发送者 / 所在群聊 / 包含成员. It's controlled, so this harness plays
// the panel's role: it owns the query (candidate filtering happens here, the
// same way the debounced dataSource loaders narrow the pool) and the picked
// ids (multi vs single selection reducer).
function Harness({
  mode,
  master,
}: {
  mode: "multi" | "single";
  master: FilterSearchOption[];
}) {
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState<string[]>([]);

  const q = query.trim().toLowerCase();
  const options = q
    ? master.filter((o) => o.name.toLowerCase().includes(q))
    : master;
  const selected = master.filter((o) => ids.includes(o.id));

  const onToggle = (id: string) =>
    setIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      return mode === "single" ? [id] : [...cur, id];
    });

  return (
    <FilterSearchSelect
      title="filter"
      placeholder="搜索"
      query={query}
      onQueryChange={setQuery}
      options={options}
      selected={selected}
      isSelected={(id) => ids.includes(id)}
      onToggle={onToggle}
      listboxId="test-listbox"
    />
  );
}

const SENDERS: FilterSearchOption[] = [
  { id: "u1", name: "Alice" },
  { id: "u2", name: "Bob" },
  { id: "u3", name: "Carol" },
];

const CHANNELS: FilterSearchOption[] = [
  { id: "2:g1", name: "Product" },
  { id: "2:g2", name: "Platform" },
  { id: "1:u9", name: "Direct Dave" },
];

const MEMBERS: FilterSearchOption[] = [
  { id: "m1", name: "Mallory" },
  { id: "m2", name: "Niaj" },
];

const openDropdown = () => fireEvent.focus(screen.getByRole("textbox"));
const listbox = () => screen.getByRole("listbox");
const field = () => screen.getByRole("combobox");

describe("FilterSearchSelect — 发送者 (multi)", () => {
  it("输入过滤候选：typing narrows the dropdown to matching options", () => {
    render(<Harness mode="multi" master={SENDERS} />);
    openDropdown();
    // All candidates visible before filtering.
    expect(within(listbox()).getByText("Alice")).toBeInTheDocument();
    expect(within(listbox()).getByText("Bob")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "ali" },
    });

    expect(within(listbox()).getByText("Alice")).toBeInTheDocument();
    expect(within(listbox()).queryByText("Bob")).not.toBeInTheDocument();
    expect(within(listbox()).queryByText("Carol")).not.toBeInTheDocument();
  });

  it("点选加 chip：clicking an option adds a chip into the field", () => {
    render(<Harness mode="multi" master={SENDERS} />);
    openDropdown();
    fireEvent.click(within(listbox()).getByText("Alice"));

    // Chip is rendered inside the combobox field.
    expect(
      within(field()).getByRole("button", { name: /Alice/ })
    ).toBeInTheDocument();
    // Multi-select: a second pick coexists with the first.
    fireEvent.click(within(listbox()).getByText("Bob"));
    expect(
      within(field()).getByRole("button", { name: /Alice/ })
    ).toBeInTheDocument();
    expect(
      within(field()).getByRole("button", { name: /Bob/ })
    ).toBeInTheDocument();
  });

  it("移除 chip：clicking a chip removes it from the field", () => {
    render(<Harness mode="multi" master={SENDERS} />);
    openDropdown();
    fireEvent.click(within(listbox()).getByText("Alice"));
    const chip = within(field()).getByRole("button", { name: /Alice/ });
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);

    expect(
      within(field()).queryByRole("button", { name: /Alice/ })
    ).not.toBeInTheDocument();
  });

  it("选中候选后清空输入 + 保持下拉打开：mirrors ChannelSearch's chooseSender", () => {
    // Regression for YUJ-19: picking a candidate from the dropdown must reset
    // the typed query (so the user can search for the next name from a clean
    // input) and keep the listbox open so the follow-up pick doesn't need
    // another focus click. ChannelSearch's `chooseSender` does exactly this.
    render(<Harness mode="multi" master={SENDERS} />);
    openDropdown();

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ali" } });
    // Narrowed pool now only shows Alice.
    expect(within(listbox()).getByText("Alice")).toBeInTheDocument();
    expect(within(listbox()).queryByText("Bob")).not.toBeInTheDocument();

    fireEvent.click(within(listbox()).getByText("Alice"));

    // Query is now cleared.
    expect(input.value).toBe("");
    // Dropdown is still open, showing the full candidate pool again.
    expect(within(listbox()).getByText("Alice")).toBeInTheDocument();
    expect(within(listbox()).getByText("Bob")).toBeInTheDocument();
    expect(within(listbox()).getByText("Carol")).toBeInTheDocument();
    // Alice chip has landed in the field.
    expect(
      within(field()).getByRole("button", { name: /Alice/ })
    ).toBeInTheDocument();
  });
});

describe("FilterSearchSelect — 所在群聊 (multi, composite ids)", () => {
  it("输入过滤候选", () => {
    render(<Harness mode="multi" master={CHANNELS} />);
    openDropdown();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "platform" },
    });
    expect(within(listbox()).getByText("Platform")).toBeInTheDocument();
    expect(within(listbox()).queryByText("Product")).not.toBeInTheDocument();
  });

  it("点选加 chip / 移除 chip", () => {
    render(<Harness mode="multi" master={CHANNELS} />);
    openDropdown();
    fireEvent.click(within(listbox()).getByText("Product"));
    const chip = within(field()).getByRole("button", { name: /Product/ });
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);
    expect(
      within(field()).queryByRole("button", { name: /Product/ })
    ).not.toBeInTheDocument();
  });
});

describe("FilterSearchSelect — 包含成员 (single)", () => {
  it("输入过滤候选", () => {
    render(<Harness mode="single" master={MEMBERS} />);
    openDropdown();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "mal" },
    });
    expect(within(listbox()).getByText("Mallory")).toBeInTheDocument();
    expect(within(listbox()).queryByText("Niaj")).not.toBeInTheDocument();
  });

  it("点选加 chip then re-pick replaces the single selection", () => {
    render(<Harness mode="single" master={MEMBERS} />);
    openDropdown();
    fireEvent.click(within(listbox()).getByText("Mallory"));
    expect(
      within(field()).getByRole("button", { name: /Mallory/ })
    ).toBeInTheDocument();

    // Single-select: picking another replaces (not appends).
    fireEvent.click(within(listbox()).getByText("Niaj"));
    expect(
      within(field()).getByRole("button", { name: /Niaj/ })
    ).toBeInTheDocument();
    expect(
      within(field()).queryByRole("button", { name: /Mallory/ })
    ).not.toBeInTheDocument();
  });

  it("移除 chip", () => {
    render(<Harness mode="single" master={MEMBERS} />);
    openDropdown();
    fireEvent.click(within(listbox()).getByText("Mallory"));
    const chip = within(field()).getByRole("button", { name: /Mallory/ });
    fireEvent.click(chip);
    expect(
      within(field()).queryByRole("button", { name: /Mallory/ })
    ).not.toBeInTheDocument();
  });
});
