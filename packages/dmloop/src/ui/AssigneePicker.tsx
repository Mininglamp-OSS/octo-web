import React, { useEffect, useRef, useState } from "react";
import { Dropdown, Avatar } from "@douyinfe/semi-ui";
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
  // 请求序号:挂载 + 每次开框都会重取候选,多个 in-flight 时只让最新一次落地
  // (镜像 SettingsPage 的 seqRef 守卫);旧请求后到不得覆盖新候选。
  const seqRef = useRef(0);

  // 挂载先取一次;每次开框再取 —— afterDirectoryMutation 只清共享缓存,挂载中的 picker
  // 不会自动重读,故开框时刷新以反映其间的成员/agent/squad 增删。
  const loadCands = () => {
    const my = ++seqRef.current;
    listAssigneeCandidates()
      .then((list) => { if (my === seqRef.current) setCands(list); })
      .catch(() => { if (my === seqRef.current) setCands([]); });
  };
  // 卸载时自增序号,使在途响应全部作废(避免卸载后 setState)。
  useEffect(() => { loadCands(); return () => { seqRef.current++; }; }, []);

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
    <Dropdown render={menu} trigger="click" position="bottomLeft" clickToHide onVisibleChange={(v) => { if (v) loadCands(); }}>
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

/** 只读小徽标：中性胶囊 + 类型图标（member/agent/squad 靠图标形状区分，不用高亮色，避免突兀）。 */
export function AssigneeBadge({ type, name }: { type: AssigneeType | null; name: string | null }) {
  if (!type || !name) return <span className="loop-assignee-empty">—</span>;
  return (
    <span className="loop-abadge" data-type={type}>
      {typeIcon(type)}
      <span className="loop-abadge__name">{name}</span>
    </span>
  );
}
