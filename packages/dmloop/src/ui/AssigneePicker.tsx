import React, { useEffect, useState } from "react";
import { Dropdown, Avatar, Tag } from "@douyinfe/semi-ui";
import { ChevronDown, User, Bot, Users, CircleSlash } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { AssigneeCandidate, AssigneeType } from "../api/types";
import { listAssigneeCandidates } from "../api/issueApi";
import { ASSIGNEE_TYPE_COLOR } from "./meta";

function typeIcon(type: AssigneeType) {
  if (type === "agent") return <Bot size={13} />;
  if (type === "squad") return <Users size={13} />;
  return <User size={13} />;
}

export interface AssigneePickerProps {
  value: string | null;
  valueName: string | null;
  onChange: (id: string | null, type: AssigneeType | null, name: string | null) => void;
  size?: "small" | "default";
  // 限定可选类型（默认三态 member/agent/squad）。传入后只渲染这些组，
  // 且当其中不含 member 时隐藏「未指派」项——用于「执行方」只能是 agent/squad。
  types?: AssigneeType[];
}

/** 三态指派选择器：member / agent / squad，支持清空。onChange 同时回传 type。 */
export default function AssigneePicker({ value, valueName, onChange, size = "default", types }: AssigneePickerProps) {
  const { t } = useI18n();
  const [cands, setCands] = useState<AssigneeCandidate[]>([]);

  useEffect(() => {
    listAssigneeCandidates().then(setCands).catch(() => setCands([]));
  }, []);

  const current = cands.find((c) => c.id === value);
  const allGroups: { type: AssigneeType; label: string }[] = [
    { type: "member", label: t("loop.assignee.member") },
    { type: "agent", label: t("loop.assignee.agent") },
    { type: "squad", label: t("loop.assignee.squad") },
  ];
  const groups = types ? allGroups.filter((g) => types.includes(g.type)) : allGroups;
  // 只有当可选类型包含 member 时才提供「未指派」（执行方场景 types=[agent,squad] 不允许清空）。
  const allowUnassigned = !types || types.includes("member");

  const menu = (
    <Dropdown.Menu>
      {allowUnassigned && (
        <Dropdown.Item onClick={() => onChange(null, null, null)} icon={<CircleSlash size={13} />}>
          {t("loop.assignee.unassigned")}
        </Dropdown.Item>
      )}
      {groups.map((g) => {
        const items = cands.filter((c) => c.type === g.type);
        if (items.length === 0) return null;
        return (
          <React.Fragment key={g.type}>
            <Dropdown.Divider />
            <Dropdown.Title>{g.label}</Dropdown.Title>
            {items.map((c) => (
              <Dropdown.Item
                key={c.id}
                icon={c.type === "member" && c.octo_uid
                  ? <Avatar size="extra-extra-small" color="light-blue" src={WKApp.shared.avatarUser(c.octo_uid)}>{c.name.slice(0, 1)}</Avatar>
                  : typeIcon(c.type)}
                active={c.id === value}
                onClick={() => onChange(c.id, c.type, c.name)}
              >
                {c.name}
              </Dropdown.Item>
            ))}
          </React.Fragment>
        );
      })}
    </Dropdown.Menu>
  );

  return (
    <Dropdown render={menu} trigger="click" position="bottomLeft" clickToHide>
      <span className="loop-assignee-trigger" style={{ fontSize: size === "small" ? 12 : 13 }}>
        {current || valueName ? (
          <>
            <Avatar
              size="extra-extra-small"
              color={ASSIGNEE_TYPE_COLOR[current?.type ?? "member"] as never}
              src={current?.octo_uid ? WKApp.shared.avatarUser(current.octo_uid) : undefined}
            >
              {(current?.name ?? valueName ?? "?").slice(0, 1)}
            </Avatar>
            <span className="loop-assignee-name">{current?.name ?? valueName}</span>
          </>
        ) : (
          <span className="loop-assignee-empty">
            <CircleSlash size={13} />
            {t("loop.assignee.unassigned")}
          </span>
        )}
        <ChevronDown size={13} style={{ opacity: 0.5 }} />
      </span>
    </Dropdown>
  );
}

/** 只读小徽标：展示 assignee 类型 + 名称。 */
export function AssigneeBadge({ type, name }: { type: AssigneeType | null; name: string | null }) {
  if (!type || !name) return <span className="loop-assignee-empty">—</span>;
  return (
    <Tag color={ASSIGNEE_TYPE_COLOR[type]} size="small" shape="circle">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {typeIcon(type)}
        {name}
      </span>
    </Tag>
  );
}
