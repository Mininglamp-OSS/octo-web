import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChannelSettingInlineEditRow } from "../index";

vi.mock("@douyinfe/semi-icons", () => ({
  IconClear: () => <span aria-hidden="true">x</span>,
}));

vi.mock("@douyinfe/semi-ui", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Input: ({ suffix, onChange, ...props }: any) => (
    <label>
      <input
        {...props}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {suffix}
    </label>
  ),
  TextArea: ({ onChange, ...props }: any) => (
    <textarea
      {...props}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  ),
}));

vi.mock("../../../Components/ListItem", () => ({
  ListItem: ({ title, onClick }: any) => <button onClick={onClick}>{title}</button>,
  ListItemButton: vi.fn(),
  ListItemButtonType: { default: "default", warn: "warn" },
  ListItemIcon: vi.fn(),
  ListItemMuliteLine: vi.fn(),
  ListItemSwitch: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  t: (key: string) => key,
}));

describe("ChannelSettingInlineEditRow", () => {
  it("clears an existing value and saves the empty nickname", async () => {
    const onSave = vi.fn(() => Promise.resolve());

    render(
      <ChannelSettingInlineEditRow
        title="My nickname"
        value="Old nickname"
        allowEmpty
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "My nickname" }));

    const input = screen.getByDisplayValue("Old nickname") as HTMLInputElement;
    fireEvent.mouseDown(
      screen.getByRole("button", { name: "My nickname-base.common.clear" })
    );

    expect(input.value).toBe("");

    const save = screen.getByRole("button", { name: "base.common.save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledWith("");
  });

  it("keeps the draft open when saving fails", async () => {
    const onSave = vi.fn(() => Promise.resolve(false));

    render(
      <ChannelSettingInlineEditRow
        title="Group name"
        value="Old name"
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Group name" }));

    const input = screen.getByDisplayValue("Old name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Unsaved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "base.common.save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Unsaved draft"));
    expect(screen.getByDisplayValue("Unsaved draft")).toBe(input);
    expect(screen.getByRole("button", { name: "base.common.cancel" })).toBeEnabled();
  });
});
