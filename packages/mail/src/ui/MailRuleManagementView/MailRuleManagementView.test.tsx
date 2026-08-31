// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MailRule, MailRuleConditionField } from "../../bridge/types";
import MailRuleManagementView from ".";

const labels: Record<string, string> = {
  "mail.rules.create": "新建规则",
  "mail.rules.createTitle": "新建邮件规则",
  "mail.rules.conditionsTitle": "当新邮件到达时",
  "mail.rules.matchMode": "条件匹配方式",
  "mail.rules.matchAll": "所有条件",
  "mail.rules.matchAny": "任一条件",
  "mail.rules.addCondition": "添加条件",
  "mail.rules.conditionType": "条件类型",
  "mail.rules.conditionOperator": "匹配方式",
  "mail.rules.conditionGroupContent": "按内容",
  "mail.rules.conditionGroupPeople": "按人员",
  "mail.rules.deleteCondition": "删除条件",
  "mail.rules.from": "发件人",
  "mail.rules.to": "收件人",
  "mail.rules.subject": "主题",
  "mail.rules.body": "正文",
  "mail.rules.subject_or_body": "主题或正文",
  "mail.rules.equals": "等于",
  "mail.rules.contains": "包含",
  "mail.rules.not_contains": "不包含",
  "mail.rules.fromPlaceholder": "发件人地址",
  "mail.rules.subjectPlaceholder": "主题关键词",
  "mail.rules.bodyPlaceholder": "正文关键词",
  "mail.rules.subject_or_bodyPlaceholder": "主题或正文关键词",
  "mail.rules.toPlaceholder": "收件人地址",
  "mail.rules.actionsTitle": "执行以下动作",
  "mail.rules.forwardTo": "转发至固定地址",
  "mail.rules.addAction": "添加动作",
  "mail.rules.deleteAction": "删除动作",
  "mail.rules.targetPlaceholder": "转发地址",
  "mail.rules.enableAfterSave": "保存后应用该规则（历史邮件不在范围内）",
  "mail.rules.deleteTitle": "删除这条邮件规则？",
  "mail.rules.deleteConfirm": "确认删除规则“{{name}}”？",
  "mail.rules.name": "名称",
  "mail.rules.namePlaceholder": "规则名称",
  "mail.actions.cancel": "取消",
  "mail.actions.delete": "删除",
  "mail.actions.save": "保存",
  "mail.rules.edit": "编辑规则",
  "mail.rules.enable": "启用规则",
  "mail.rules.disable": "停用规则",
  "mail.rules.enabled": "已启用",
  "mail.rules.disabled": "已停用",
};

describe("MailRuleManagementView editor", () => {
  afterEach(() => cleanup());

  it("supports all/any matching and row-based condition/action editing", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key, options) => {
          if (key === "mail.rules.conditionsHint") {
            return `已添加 ${String(options?.values?.count)} / ${String(
              options?.values?.limit
            )} 个条件；至少添加并填写一个条件。`;
          }
          return labels[key] ?? key;
        }}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={onSave}
        onSetEnabled={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "新建规则" })[0]!);
    fireEvent.change(screen.getByRole("combobox", { name: "条件匹配方式" }), {
      target: { value: "any" },
    });

    const conditionTypes = screen.getAllByRole("combobox", {
      name: /^条件类型 \d+$/,
    });
    expect((conditionTypes[0] as HTMLSelectElement).value).toBe("from");
    expect(screen.getAllByRole("group", { name: "按内容" })).toHaveLength(1);
    expect(screen.getAllByRole("group", { name: "按人员" })).toHaveLength(1);
    expect(
      screen.getByText("已添加 1 / 5 个条件；至少添加并填写一个条件。")
    ).toBeTruthy();
    fireEvent.change(
      screen.getAllByRole("combobox", { name: /^匹配方式 \d+$/ })[0]!,
      { target: { value: "not_contains" } }
    );

    expect(
      screen.getAllByRole("button", { name: /^删除条件 \d+$/ })
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "添加条件" }));
    expect(
      screen.getByText("已添加 2 / 5 个条件；至少添加并填写一个条件。")
    ).toBeTruthy();
    const secondConditionType = screen.getByRole("combobox", {
      name: "条件类型 2",
    }) as HTMLSelectElement;
    expect(
      Array.from(secondConditionType.options)
        .filter((option) => option.value)
        .map((option) => [option.value, option.disabled])
    ).toEqual([
      ["subject", false],
      ["body", false],
      ["subject_or_body", false],
      ["from", false],
      ["to", false],
    ]);
    const deleteConditions = screen.getAllByRole("button", {
      name: /^删除条件 \d+$/,
    });
    expect(deleteConditions).toHaveLength(2);
    fireEvent.click(deleteConditions[1]!);
    expect(
      screen.getAllByRole("button", { name: /^删除条件 \d+$/ })
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "添加条件" }));
    expect(
      screen.getAllByRole("button", { name: /^删除条件 \d+$/ })
    ).toHaveLength(2);

    const firstTarget = screen.getByRole("textbox", {
      name: "转发至固定地址 1",
    });
    fireEvent.click(screen.getByRole("button", { name: "添加动作" }));
    expect(
      screen.getAllByRole("button", { name: /^删除动作 \d+$/ })
    ).toHaveLength(2);
    const secondTarget = screen.getByRole("textbox", {
      name: "转发至固定地址 2",
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^删除动作 \d+$/ })[0]!
    );
    expect(firstTarget).not.toBe(secondTarget);
    expect(screen.getByRole("textbox", { name: "转发至固定地址 1" })).toBe(
      secondTarget
    );

    fireEvent.change(screen.getByPlaceholderText("规则名称"), {
      target: { value: "VIP 邮件" },
    });
    const senderInput = screen.getByRole("textbox", { name: "发件人 1" });
    expect((senderInput as HTMLInputElement).maxLength).toBe(500);
    fireEvent.change(senderInput, {
      target: { value: "vip@example.com" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "主题 2" }), {
      target: { value: "urgent" },
    });
    expect(screen.getByRole("combobox", { name: "条件类型 2" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "匹配方式 2" })).toBeTruthy();
    fireEvent.change(
      screen.getByRole("textbox", { name: "转发至固定地址 1" }),
      {
        target: { value: "owner@example.com," },
      }
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "新建规则" }).at(-1)!
    );

    expect(onSave).toHaveBeenCalledWith(
      {
        name: "VIP 邮件",
        enabled: true,
        priority: 0,
        matchMode: "any",
        conditions: [
          {
            field: "from",
            operator: "not_contains",
            value: "vip@example.com",
          },
          { field: "subject", operator: "contains", value: "urgent" },
        ],
        forwardTargets: ["owner@example.com"],
      },
      undefined
    );
  });

  it("resets a projected sender equals operator when its field changes", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[
          {
            id: "legacy-rule",
            name: "旧发件人规则",
            enabled: true,
            priority: 0,
            matchFrom: "vip@example.com",
            forwardTargets: ["owner@example.com"],
            createdAt: "2026-08-17T00:00:00Z",
            updatedAt: "2026-08-17T00:00:00Z",
          } as MailRule,
        ]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key) => labels[key] ?? key}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={onSave}
        onSetEnabled={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑规则" }));
    const conditionType = screen.getByRole("combobox", { name: "条件类型 1" });
    fireEvent.change(conditionType, {
      target: { value: "subject" },
    });
    expect(screen.getByRole("combobox", { name: "条件类型 1" })).toBe(
      conditionType
    );
    expect(
      (
        screen.getByRole("combobox", {
          name: "匹配方式 1",
        }) as HTMLSelectElement
      ).value
    ).toBe("contains");

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      {
        name: "旧发件人规则",
        enabled: true,
        priority: 0,
        matchMode: "all",
        conditions: [
          {
            field: "subject",
            operator: "contains",
            value: "vip@example.com",
          },
        ],
        forwardTargets: ["owner@example.com"],
      },
      "legacy-rule"
    );
  });

  it("creates repeated field conditions through the editor", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key) => labels[key] ?? key}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={onSave}
        onSetEnabled={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "新建规则" })[0]!);
    fireEvent.change(screen.getByRole("textbox", { name: "名称" }), {
      target: { value: "正文组合规则" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "条件类型 1" }), {
      target: { value: "body" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "正文 1" }), {
      target: { value: "alpha" },
    });

    fireEvent.click(screen.getByRole("button", { name: "添加条件" }));
    fireEvent.change(screen.getByRole("combobox", { name: "条件类型 2" }), {
      target: { value: "body" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "正文 2" }), {
      target: { value: "beta" },
    });
    fireEvent.change(
      screen.getByRole("textbox", { name: "转发至固定地址 1" }),
      { target: { value: "owner@example.com" } }
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "新建规则" }).at(-1)!
    );

    expect(onSave).toHaveBeenCalledWith(
      {
        name: "正文组合规则",
        enabled: true,
        priority: 0,
        matchMode: "all",
        conditions: [
          { field: "body", operator: "contains", value: "alpha" },
          { field: "body", operator: "contains", value: "beta" },
        ],
        forwardTargets: ["owner@example.com"],
      },
      undefined
    );
  });

  it("does not save an API rule with more than five conditions", () => {
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[
          {
            id: "invalid-rule",
            name: "异常规则",
            enabled: true,
            priority: 0,
            matchMode: "all",
            conditions: [
              { field: "from", operator: "contains", value: "a" },
              { field: "to", operator: "contains", value: "b" },
              { field: "subject", operator: "contains", value: "c" },
              { field: "body", operator: "contains", value: "d" },
              {
                field: "subject_or_body",
                operator: "contains",
                value: "e",
              },
              {
                field: "unexpected" as MailRuleConditionField,
                operator: "contains",
                value: "f",
              },
            ],
            forwardTargets: ["owner@example.com"],
            createdAt: "2026-08-17T00:00:00Z",
            updatedAt: "2026-08-17T00:00:00Z",
          },
        ]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key) => labels[key] ?? key}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
        onSetEnabled={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑规则" }));
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("saves five conditions that repeat the same field", () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const conditions = ["alpha", "beta", "gamma", "delta", "epsilon"].map(
      (value) => ({
        field: "body" as const,
        operator: "contains" as const,
        value,
      })
    );
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[
          {
            id: "duplicate-rule",
            name: "重复条件规则",
            enabled: true,
            priority: 0,
            matchMode: "all",
            conditions,
            forwardTargets: ["owner@example.com"],
            createdAt: "2026-08-17T00:00:00Z",
            updatedAt: "2026-08-17T00:00:00Z",
          },
        ]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key) => labels[key] ?? key}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={onSave}
        onSetEnabled={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑规则" }));
    expect(
      (
        screen.getByRole("button", {
          name: "添加条件",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "保存" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(
      {
        name: "重复条件规则",
        enabled: true,
        priority: 0,
        matchMode: "all",
        conditions,
        forwardTargets: ["owner@example.com"],
      },
      "duplicate-rule"
    );
  });

  it("uses the centered product confirmation before deleting a rule", () => {
    const onDelete = vi.fn();
    render(
      <MailRuleManagementView
        mailbox={{
          id: "mailbox-1",
          address: "agent@example.com",
          connectState: "connected",
          outboundMode: "manual_confirmation",
        }}
        rules={[
          {
            id: "rule-1",
            name: "VIP 邮件",
            enabled: true,
            priority: 0,
            matchMode: "all",
            conditions: [{ field: "from", operator: "contains", value: "vip" }],
            forwardTargets: ["owner@example.com"],
            createdAt: "2026-08-17T00:00:00Z",
            updatedAt: "2026-08-17T00:00:00Z",
          },
        ]}
        loading={false}
        error=""
        actionError=""
        saving={false}
        deletingId=""
        t={(key, options) => {
          if (key === "mail.rules.deleteConfirm") {
            return `确认删除规则“${String(options?.values?.name)}”？`;
          }
          return labels[key] ?? key;
        }}
        onBack={vi.fn()}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
        onSetEnabled={vi.fn()}
        onDelete={onDelete}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("删除这条邮件规则？")).toBeTruthy();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);
    fireEvent.click(screen.getAllByRole("button", { name: "删除" }).at(-1)!);
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1" })
    );
  });
});
