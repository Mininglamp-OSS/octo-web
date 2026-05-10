import React, { useState, useRef, useEffect, useCallback } from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import type {
  MatterDetail,
  MatterStatus,
  MatterChannel as MatterChannelType,
  TimelineEntry,
  TimelineReq,
} from "../../bridge/types";
import {
  getMatter,
  updateMatter,
  transitionMatter,
  deleteMatter,
  linkChannel,
  unlinkChannel,
  listTimeline,
  addTimelineEntry,
  deleteTimelineEntry,
  addAssignee,
  removeAssignee,
} from "../../api/todoApi";
import { Toast } from "../../utils/toast";
import UserName from "../../ui/UserName";
import LinkChannelsModal from "../../ui/LinkChannelsModal";
import OwnerEditor from "../../ui/OwnerEditor";
import AnchorPopover from "../../ui/AnchorPopover";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { WKApp } from "@octo/base";
import { useChannelName } from "../../hooks/useChannelName";
import "./index.css";

export interface MatterDetailPanelProps {
  channelId: string;
  channelType: number;
  matterId?: string;
  onClose: () => void;
}

export default function MatterDetailPanel({
  channelId,
  channelType: _channelType,
  matterId,
  onClose,
}: MatterDetailPanelProps) {
  const [matter, setMatter] = useState<MatterDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "channels" | "outputs" | "changelog"
  >("channels");

  // Timeline
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [expandedTimelines, setExpandedTimelines] = useState<Set<string>>(
    new Set(),
  );
  // "查看原消息上下文" 弹框状态: 记录要查的消息 id 列表 + 所在 channel
  const [anchor, setAnchor] = useState<{
    channelId: string;
    channelType: number;
    channelName: string;
    messageIds: string[];
  } | null>(null);
  // 拉取 timeline (matter 加载时 + 每次展开时都调, 保证数据新鲜)。
  // 后端 GET /matters/:id/timeline 不支持按 channel 过滤, 返回整个 Matter
  // 下的全量 timeline, 前端按 entry.channel_id 本地分配到各 channel 卡片。
  const loadTimeline = useCallback(async () => {
    if (!matterId) {
      setTimeline([]);
      return;
    }
    setTimelineLoading(true);
    try {
      const res = await listTimeline(matterId, { limit: 50 });
      setTimeline(res.data || []);
    } catch {
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [matterId]);
  const toggleTimeline = useCallback(
    (chId: string) => {
      setExpandedTimelines((prev) => {
        const next = new Set(prev);
        if (next.has(chId)) {
          next.delete(chId);
        } else {
          next.add(chId);
          // 每次展开时重新拉, 避免 matter 加载后新产生的 timeline 看不到
          loadTimeline();
        }
        return next;
      });
    },
    [loadTimeline],
  );
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // Fetch matter
  useEffect(() => {
    if (!matterId) {
      setMatter(null);
      return;
    }
    setLoading(true);
    setError(null);
    getMatter(matterId, channelId || undefined)
      .then(setMatter)
      .catch((err) => {
        setError(err?.message || "加载失败");
        setMatter(null);
      })
      .finally(() => setLoading(false));
  }, [matterId, channelId]);

  // Fetch timeline when matter loads. 展开时还会再拉一次 (loadTimeline)。
  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  // ── Handlers ──

  const handleStatusChange = useCallback(
    async (newStatus: MatterStatus) => {
      if (!matter) return;
      const oldStatus = matter.status;
      setMatter((prev) => (prev ? { ...prev, status: newStatus } : prev));
      try {
        const updated = await transitionMatter(matter.id, newStatus);
        setMatter(updated);
      } catch (err: any) {
        setMatter((prev) => (prev ? { ...prev, status: oldStatus } : prev));
        const msg =
          err?.response?.data?.error?.message || err?.message || "状态修改失败";
        if (msg.includes("only creator")) {
          Toast.error("仅创建人可以归档/取消归档");
        } else {
          Toast.error(msg);
        }
      }
    },
    [matter],
  );

  const handleDeleteMatter = useCallback(async () => {
    if (!matter) return;
    if (!window.confirm(`确定删除事项「${matter.title}」？此操作不可恢复。`))
      return;
    try {
      await deleteMatter(matter.id);
      Toast.success("事项已删除");
      onClose();
    } catch {
      Toast.error("删除失败");
    }
  }, [matter, onClose]);

  const handleLinkChannel = useCallback(() => {
    setLinkModalOpen(true);
  }, []);

  const handleLinked = useCallback(async () => {
    if (!matter) return;
    const updated = await getMatter(matter.id);
    setMatter(updated);
  }, [matter]);

  const handleUnlinkChannel = useCallback(
    async (chId: string) => {
      if (!matter) return;
      if (!window.confirm("确定取消关联此频道？")) return;
      try {
        await unlinkChannel(matter.id, chId);
        const updated = await getMatter(matter.id);
        setMatter(updated);
        Toast.success("已取消关联");
      } catch {
        Toast.error("取消关联失败");
      }
    },
    [matter],
  );

  const handleDeleteTimeline = useCallback(
    async (entryId: string) => {
      if (!matter) return;
      try {
        await deleteTimelineEntry(matter.id, entryId);
        setTimeline((prev) => prev.filter((e) => e.id !== entryId));
        Toast.success("已删除");
      } catch {
        Toast.error("删除失败");
      }
    },
    [matter],
  );

  const handleAddTimeline = useCallback(
    async (content: string) => {
      if (!matter || !content.trim()) return;
      try {
        const entry = await addTimelineEntry(matter.id, {
          content: content.trim(),
        });
        setTimeline((prev) => [entry, ...prev]);
      } catch (e: any) {
        const code = e?.response?.data?.error?.code;
        if (code === "LLM_UPSTREAM_ERROR") {
          Toast.error("AI 服务暂时不可用，请稍后重试");
        } else {
          Toast.error("添加失败");
        }
      }
    },
    [matter],
  );

  // ── 负责人 toggle：添加或移除 assignee，成功后拉取最新 matter ──
  // 权限判断在 UI 层已拦掉无权用户（OwnerEditor canEdit=false 不弹下拉），
  // 这里兜底任何异常都 Toast，不回滚 optimistic（直接 refetch 是事实之源）
  const handleToggleAssignee = useCallback(
    async (uid: string, isCurrentlyAssigned: boolean) => {
      if (!matter) return;
      try {
        if (isCurrentlyAssigned) {
          await removeAssignee(matter.id, uid);
        } else {
          await addAssignee(matter.id, uid);
        }
        const updated = await getMatter(matter.id);
        setMatter(updated);
      } catch (err: any) {
        const msg =
          err?.response?.data?.error?.message ||
          err?.message ||
          (isCurrentlyAssigned ? "移除负责人失败" : "添加负责人失败");
        Toast.error(msg);
      }
    },
    [matter],
  );

  // ── Hooks: 必须在任何 early return 之前调用, 保证每次渲染 hook 顺序一致 ──
  // source_name 是创建时拍的快照, 可能是 NULL 或跟当前群名不一致 (群改名)。
  // 按需拿 channel id+type 反查最新 channel 名字, 保证展示永远是当前群名。
  // 未命中时返回空串, 下面兜底到 source_name, 再兜底到 "未知群聊"。
  // 注意: matter 可能还没加载, 用 optional chaining 让 hook 总是被调用。
  const liveSourceName = useChannelName(
    matter?.source_channel_id,
    matter?.source_channel_type,
  );

  // ── Empty / Loading / Error ──

  if (!matterId || loading || error || !matter) {
    return (
      <main className="wk-mp-main">
        <div className="wk-mp-main__empty">
          {loading ? "加载中..." : error || "选择一个事项查看详情"}
        </div>
      </main>
    );
  }

  const channels = matter.channels || [];
  const assignees = matter.assignees || [];
  // 权限规则 (17-Matters-数据流修正-v0.7.md §5.2 的推导):
  //   - 创建人 (creator) 或 当前负责人 (assignees 之一) 才能改负责人
  //   - 关联群聊成员无权修改
  const currentUid = WKApp.loginInfo.uid;
  const canEditOwner =
    !!currentUid &&
    (matter.creator_id === currentUid ||
      assignees.some((a) => a.user_id === currentUid));
  // 候选成员来源: Matter 所有关联 channel 成员的并集 (PRD §5.1)。
  //   - matter.channels 是通过 POST /matters/:id/channels 关联的所有群
  //   - matter.source_channel 是创建时的发起群, 通常也在 matter.channels 里,
  //     但为了兼容极端数据 (例如关联后又解绑了发起群) 再做一次 union
  //   - 按 (channel_id, channel_type) 去重后传给 OwnerEditor
  const ownerCandidateChannels = (() => {
    const seen = new Set<string>();
    const list: { channelId: string; channelType: number }[] = [];
    const push = (id: string | undefined | null, type: number | undefined | null) => {
      if (!id || type === undefined || type === null) return;
      const key = `${id}:${type}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ channelId: id, channelType: type });
    };
    for (const ch of matter.channels || []) {
      push(ch.channel_id, ch.channel_type);
    }
    push(matter.source_channel_id, matter.source_channel_type);
    return list;
  })();

  // 转发权限 (PRD §5.2 要点 [1]): 只给发起人 + 负责人, 关联成员按钮直接隐藏。
  // 条件跟 canEditOwner 一致, 但语义上是两个独立规则, 分开命名避免耦合。
  const canForward = canEditOwner;

  const formatDeadline = (d: string) => {
    const date = new Date(d);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // 格式化来源时间: 5/1 16:00 (跟原型对齐)
  const formatSourceTime = (iso: string) => {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  };

  const displaySourceName =
    liveSourceName || matter.source_name || "未知群聊";

  const tabs: {
    id: "channels" | "outputs" | "changelog";
    label: string;
    count: number;
  }[] = [
    { id: "channels", label: "关联群聊", count: channels.length },
    { id: "outputs", label: "产出文件", count: 0 },
    { id: "changelog", label: "变更记录", count: timeline.length },
  ];

  return (
    <main className="wk-mp-main">
      <div className="wk-mp-main__inner">
        {/* ── Header ── */}
        <header className="wk-mp-header">
          <div className="wk-mp-header__row1">
            <span className="wk-mp-header__id">
              {matter.seq_no ? `M-${matter.seq_no}` : matter.id.slice(0, 8)}
            </span>
            <StatusPicker
              status={matter.status}
              onChange={handleStatusChange}
              isCreator={matter.creator_id === WKApp.loginInfo.uid}
            />
            <EditableDeadline
              value={matter.deadline || null}
              onSave={async (newVal) => {
                const updated = await updateMatter(matter.id, {
                  deadline: newVal || "",
                });
                setMatter(updated);
              }}
            />
            {canForward && (
              <button
                type="button"
                className="wk-mp-header__action"
                title="转发"
                onClick={handleLinkChannel}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                转发
              </button>
            )}
            <button
              type="button"
              className="wk-mp-header__close"
              onClick={onClose}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          <EditableTitle
            value={matter.title}
            onSave={async (newTitle) => {
              const updated = await updateMatter(matter.id, { title: newTitle });
              setMatter(updated);
            }}
          />
        </header>

        {/* ── 主要目标 ── */}
        <div className="wk-mp-goal">
          <div className="wk-mp-goal__label">主要目标</div>
          <EditableDescription
            value={matter.description || ""}
            onSave={async (newDesc) => {
              const updated = await updateMatter(matter.id, {
                description: newDesc || null,
              });
              setMatter(updated);
            }}
          />
          {matter.source_channel_id && (
            <div className="wk-mp-goal__source">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>来自 #{displaySourceName}</span>
              <span className="wk-mp-goal__source-sep">·</span>
              <UserName uid={matter.creator_id} />
              <span className="wk-mp-goal__source-sep">·</span>
              <span>{formatSourceTime(matter.created_at)}</span>
            </div>
          )}
        </div>

        {/* ── 创建人 / 负责人 ── */}
        <div className="wk-mp-people">
          {/* 创建人：纯展示, 按 PRD v0.7 不可变 */}
          <div className="wk-mp-people__item">
            <WKAvatar
              channel={new Channel(matter.creator_id, ChannelTypePerson)}
              style={{ width: 16, height: 16 }}
            />
            <UserName uid={matter.creator_id} className="wk-mp-people__name" />
            <span className="wk-mp-people__role">创建人</span>
          </div>
          {/* 负责人：可改 (仅发起人 OR 当前负责人), 至少保留 1 位 */}
          {assignees.length > 0 && (
            <div className="wk-mp-people__item">
              <OwnerEditor
                assignees={assignees}
                canEdit={canEditOwner}
                candidateChannels={ownerCandidateChannels}
                onToggle={handleToggleAssignee}
              />
              <span className="wk-mp-people__role">负责人</span>
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="wk-mp-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`wk-mp-tabs__btn${activeTab === t.id ? " is-active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              <span className="wk-mp-tabs__label">{t.label}</span>
              <span
                className={`wk-mp-tabs__count${activeTab === t.id ? " is-active" : ""}`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* ── Tab: 关联群聊 ── */}
        {activeTab === "channels" && (
          <div className="wk-mp-channels">
            <div className="wk-mp-channels__toolbar">
              <button
                type="button"
                className="wk-mp-channels__add"
                onClick={handleLinkChannel}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                关联新群
              </button>
            </div>
            {channels.length === 0 ? (
              <div className="wk-mp-channels__empty">暂无关联群聊</div>
            ) : (
              channels.map((ch) => (
                <div key={ch.id} className="wk-mp-channels__card">
                  <div className="wk-mp-channels__card-head">
                    <span className="wk-mp-channels__card-name">
                      #{ch.channel_name || ch.channel_id.slice(0, 8)}
                    </span>
                    <span className="wk-mp-channels__card-time">
                      {new Date(ch.created_at).toLocaleDateString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                      })}{" "}
                      关联
                    </span>
                    <ChannelMoreMenu
                      onUnlink={() => handleUnlinkChannel(ch.channel_id)}
                    />
                  </div>
                  <div className="wk-mp-channels__card-progress">
                    <div className="wk-mp-channels__card-progress-label">
                      最新进展
                    </div>
                    <div className="wk-mp-channels__card-progress-text">
                      暂无进展摘要（等待一键总结）
                    </div>
                  </div>
                  {/* 展开时间线: 按钮常显, 点击时 toggle 并 refetch。
                      不再用 timeline.length > 0 做 gate, 否则空数据时
                      用户连触发刷新的入口都没有 */}
                  <div className="wk-mp-channels__card-actions">
                    <button
                      type="button"
                      className="wk-mp-channels__timeline-btn"
                      onClick={() => toggleTimeline(ch.channel_id)}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{
                          transform: expandedTimelines.has(ch.channel_id)
                            ? "rotate(180deg)"
                            : "none",
                          transition: "transform 0.15s",
                        }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                      {expandedTimelines.has(ch.channel_id)
                        ? "收起时间线"
                        : "展开时间线"}
                    </button>
                  </div>
                  {expandedTimelines.has(ch.channel_id) &&
                    (() => {
                      const chEntries = timeline.filter(
                        (e) =>
                          e.channel_id === ch.channel_id || !e.channel_id,
                      );
                      if (timelineLoading && chEntries.length === 0) {
                        return (
                          <div className="wk-mp-empty-tab">
                            正在加载时间线...
                          </div>
                        );
                      }
                      if (chEntries.length === 0) {
                        return (
                          <div className="wk-mp-empty-tab">
                            本群暂无时间线记录
                          </div>
                        );
                      }
                      return (
                        <TimelinePanel
                          entries={chEntries}
                          onShowAnchor={(entry) =>
                            setAnchor({
                              channelId: ch.channel_id,
                              channelType: ch.channel_type,
                              channelName:
                                ch.channel_name ||
                                ch.channel_id.slice(0, 8),
                              messageIds: entry.source_msgs || [],
                            })
                          }
                        />
                      );
                    })()}
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Tab: 产出文件 ── */}
        {activeTab === "outputs" && (
          <div className="wk-mp-empty-tab">产出文件功能即将上线</div>
        )}

        {/* ── Tab: 变更记录 (timeline) ── */}
        {activeTab === "changelog" && (
          <div className="wk-mp-timeline-tab">
            <TimelineInput onSubmit={handleAddTimeline} />
            {timeline.length === 0 ? (
              <div className="wk-mp-empty-tab">暂无时间线记录</div>
            ) : (
              <TimelinePanel
                entries={timeline}
                onShowAnchor={(entry) => {
                  // 改变记录 tab 下每条 entry 可能属于不同 channel,
                  // 用 matter.channels 按 entry.channel_id 反查 channel_name
                  if (!entry.channel_id || entry.channel_type === undefined) {
                    return;
                  }
                  const ch = channels.find(
                    (c) => c.channel_id === entry.channel_id,
                  );
                  setAnchor({
                    channelId: entry.channel_id,
                    channelType: entry.channel_type,
                    channelName:
                      ch?.channel_name || entry.channel_id.slice(0, 8),
                    messageIds: entry.source_msgs || [],
                  });
                }}
              />
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="wk-mp-footer">
          ✦ Matter 是 IM 工作的 hierarchy 任务卡 · AI 从群聊持续蒸馏 ·
          用户只确认, 不维护
        </div>
      </div>

      {/* 关联群聊弹窗 */}
      <LinkChannelsModal
        visible={linkModalOpen}
        matterId={matter.id}
        matterTitle={matter.title}
        linkedChannels={channels}
        onClose={() => setLinkModalOpen(false)}
        onLinked={handleLinked}
      />

      {/* 原消息上下文弹框 */}
      {anchor && (
        <AnchorPopover
          channelId={anchor.channelId}
          channelType={anchor.channelType}
          channelName={anchor.channelName}
          messageIds={anchor.messageIds}
          onClose={() => setAnchor(null)}
        />
      )}
    </main>
  );
}

export { MatterDetailPanel };

// ─── StatusPicker ─────────────────────────────────────────

const STATUS_OPTIONS: { value: MatterStatus; label: string; cls: string }[] = [
  { value: "open", label: "进行中", cls: "wk-mp-pill--active" },
  { value: "done", label: "已完成", cls: "wk-mp-pill--done" },
  { value: "archived", label: "已归档", cls: "wk-mp-pill--archived" },
];

function StatusPicker({
  status,
  onChange,
  isCreator,
}: {
  status: MatterStatus;
  onChange: (s: MatterStatus) => void;
  isCreator: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", c);
    return () => document.removeEventListener("mousedown", c);
  }, [open]);
  const visibleOptions = isCreator
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((o) => o.value !== "archived");
  const current =
    STATUS_OPTIONS.find((o) => o.value === status) || STATUS_OPTIONS[0];
  const isArchived = status === "archived";

  return (
    <span className="wk-mp-status-wrap" ref={ref}>
      <button
        type="button"
        className={`wk-mp-pill ${current.cls}`}
        onClick={() => {
          if (!isArchived) setOpen(!open);
        }}
        title={isArchived ? "已归档事项不可修改状态" : "点击修改状态"}
        style={isArchived ? { cursor: "not-allowed", opacity: 0.8 } : undefined}
        disabled={isArchived}
      >
        <span className="wk-mp-pill__dot" />
        {current.label}
      </button>
      {open && !isArchived && (
        <div className="wk-mp-status-dropdown">
          {visibleOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`wk-mp-status-dropdown__item${opt.value === status ? " is-active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span className={`wk-mp-pill__dot ${opt.cls}`} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// ─── MoreMenu (删除事项) ──────────────────────────────────

function MoreMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", c);
    return () => document.removeEventListener("mousedown", c);
  }, [open]);
  return (
    <span className="wk-mp-more-wrap" ref={ref}>
      <button
        type="button"
        className="wk-mp-header__action"
        onClick={() => setOpen(!open)}
        title="更多操作"
      >
        <svg
          width="13"
          height="3"
          viewBox="0 0 16 4"
          fill="currentColor"
          stroke="none"
        >
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="8" cy="2" r="1.5" />
          <circle cx="14" cy="2" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="wk-mp-more-dropdown">
          <button
            type="button"
            className="wk-mp-more-dropdown__item wk-mp-more-dropdown__item--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            删除事项
          </button>
        </div>
      )}
    </span>
  );
}

// ─── ChannelMoreMenu (查看群聊 / 取消关联) ────────────────

function ChannelMoreMenu({ onUnlink }: { onUnlink: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const c = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", c);
    return () => document.removeEventListener("mousedown", c);
  }, [open]);
  return (
    <span className="wk-mp-ch-more" ref={ref} style={{ marginLeft: "auto" }}>
      <button
        type="button"
        className="wk-mp-ch-more__btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <svg
          width="13"
          height="3"
          viewBox="0 0 16 4"
          fill="currentColor"
          stroke="none"
        >
          <circle cx="2" cy="2" r="1.5" />
          <circle cx="8" cy="2" r="1.5" />
          <circle cx="14" cy="2" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="wk-mp-ch-more__dropdown">
          <button
            type="button"
            className="wk-mp-ch-more__item"
            onClick={() => setOpen(false)}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            查看群聊
          </button>
          <button
            type="button"
            className="wk-mp-ch-more__item wk-mp-ch-more__item--danger"
            onClick={() => {
              setOpen(false);
              onUnlink();
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            取消关联
          </button>
        </div>
      )}
    </span>
  );
}

// ─── TimelinePanel (群内事件时间线 — 对齐原型 v19 真实 UI) ──

/** 按日期分组 timeline entries */
function groupByDate(entries: TimelineEntry[]): Map<string, TimelineEntry[]> {
  const map = new Map<string, TimelineEntry[]>();
  for (const e of entries) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const arr = map.get(key) || [];
    arr.push(e);
    map.set(key, arr);
  }
  return map;
}

function dayLabel(key: string): { label: string; raw: string } {
  const [y, m, d] = key.split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(y, m - 1, d);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  const raw = `${m}/${d}`;
  if (diff === 0) return { label: "今天", raw };
  if (diff === 1) return { label: "昨天", raw };
  return { label: raw, raw };
}

/** 格式化时间为 HH:MM */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function TimelinePanel({
  entries,
  onShowAnchor,
}: {
  entries: TimelineEntry[];
  /**
   * 点击 "查看原消息上下文" 时调用, 由父组件负责弹 AnchorPopover。
   * 不传: 按钮 disabled (无法查看, 通常是条目没有 source_msgs 字段)。
   */
  onShowAnchor?: (entry: TimelineEntry) => void;
}) {
  const [sortNewest, setSortNewest] = useState(true);

  // 排序
  const sorted = [...entries].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return sortNewest ? tb - ta : ta - tb;
  });
  const grouped = groupByDate(sorted);

  return (
    <div className="wk-mp-tl">
      {/* Header: 标题 + 排序切换 */}
      <div className="wk-mp-tl__header">
        <span className="wk-mp-tl__title">群内事件时间线</span>
        <div className="wk-mp-tl__sort-group">
          <button
            type="button"
            className={`wk-mp-tl__sort-btn${sortNewest ? " is-active" : ""}`}
            onClick={() => setSortNewest(true)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="15" y2="12" />
              <line x1="3" y1="18" x2="9" y2="18" />
            </svg>
            最新在上
          </button>
          <button
            type="button"
            className={`wk-mp-tl__sort-btn${!sortNewest ? " is-active" : ""}`}
            onClick={() => setSortNewest(false)}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="3" y1="6" x2="9" y2="6" />
              <line x1="3" y1="12" x2="15" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            最旧在上
          </button>
        </div>
      </div>

      {/* 按日期分组 */}
      {Array.from(grouped.entries()).map(([dateKey, items]) => {
        const dl = dayLabel(dateKey);
        return (
          <div key={dateKey} className="wk-mp-tl__group">
            <div className="wk-mp-tl__date-sep">
              <span className="wk-mp-tl__date-label">{dl.label}</span>
              {dl.label !== dl.raw && (
                <span className="wk-mp-tl__date-raw">{dl.raw}</span>
              )}
              <span className="wk-mp-tl__date-line" />
            </div>

            {/* 当日条目 */}
            <div className="wk-mp-tl__entries">
              {items.map((e) => (
                <div key={e.id} className="wk-mp-tl__entry">
                  {/* 时间 */}
                  <span className="wk-mp-tl__time">
                    {formatTime(e.created_at)}
                  </span>
                  {/* 头像 + 人名 */}
                  <span className="wk-mp-tl__user">
                    <WKAvatar
                      channel={new Channel(e.user_id, ChannelTypePerson)}
                      style={{ width: 16, height: 16 }}
                    />
                    <UserName uid={e.user_id} className="wk-mp-tl__user-name" />
                  </span>
                  {/* 内容 */}
                  <span className="wk-mp-tl__content">{e.content || ""}</span>
                  {/* 附件 */}
                  {e.attachments && e.attachments.length > 0 && (
                    <span className="wk-mp-tl__att-count">
                      {e.attachments.length} 附件
                    </span>
                  )}
                  {/* ↗ 原消息: 只有 entry 带 source_msgs 时才可点 */}
                  {(() => {
                    const hasSource =
                      !!onShowAnchor &&
                      Array.isArray(e.source_msgs) &&
                      e.source_msgs.length > 0;
                    return (
                      <button
                        type="button"
                        className="wk-mp-tl__anchor-btn"
                        title={
                          hasSource
                            ? "查看原消息上下文"
                            : "无原消息关联"
                        }
                        disabled={!hasSource}
                        style={
                          !hasSource
                            ? { opacity: 0.4, cursor: "not-allowed" }
                            : undefined
                        }
                        onClick={() => {
                          if (hasSource && onShowAnchor) onShowAnchor(e);
                        }}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        ↗ 原消息
                      </button>
                    );
                  })()}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {entries.length === 0 && (
        <div className="wk-mp-tl__empty">暂无时间线记录</div>
      )}
    </div>
  );
}

// ─── TimelineInput (添加进展) ─────────────────────────────

function TimelineInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState("");
  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
  };
  return (
    <div className="wk-mp-tl-input">
      <input
        type="text"
        className="wk-mp-tl-input__field"
        placeholder="添加进展或评论..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
      <button
        type="button"
        className="wk-mp-tl-input__btn"
        disabled={!value.trim()}
        onClick={handleSubmit}
      >
        发送
      </button>
    </div>
  );
}

// ─── EditableTitle (点击编辑标题) ─────────────────────────

function EditableTitle({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    try {
      await onSave(trimmed);
    } catch {
      Toast.error("标题修改失败");
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="wk-mp-header__title wk-mp-header__title--editing"
        value={draft}
        maxLength={500}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <h1
      className="wk-mp-header__title wk-mp-header__title--clickable"
      onClick={() => setEditing(true)}
      title="点击编辑标题"
    >
      {value}
    </h1>
  );
}

// ─── EditableDescription (点击编辑描述) ───────────────────

function EditableDescription({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      // 自动调整高度
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === (value || "").trim()) {
      setDraft(value);
      setEditing(false);
      return;
    }
    try {
      await onSave(trimmed);
    } catch {
      Toast.error("描述修改失败");
      setDraft(value);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        className="wk-mp-goal__text wk-mp-goal__text--editing"
        value={draft}
        maxLength={10000}
        onChange={(e) => {
          setDraft(e.target.value);
          // 动态调整高度
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div
      className="wk-mp-goal__text wk-mp-goal__text--clickable"
      onClick={() => setEditing(true)}
      title="点击编辑描述"
    >
      {value || <span className="wk-mp-goal__placeholder">点击添加描述...</span>}
    </div>
  );
}

// ─── EditableDeadline (截止日期，使用 Semi DatePicker) ───────────

function getLocalTZOffset(): string {
  const off = new Date().getTimezoneOffset();
  const sign = off <= 0 ? "+" : "-";
  const h = String(Math.floor(Math.abs(off) / 60)).padStart(2, "0");
  const m = String(Math.abs(off) % 60).padStart(2, "0");
  return `${sign}${h}:${m}`;
}

function fromLocalDateString(s: string): Date {
  const [yyyy, mm, dd] = s.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function EditableDeadline({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string) => Promise<void>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [localDate, setLocalDate] = useState<string>(() => {
    if (!value) return "";
    const d = new Date(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  // 外部 value 变化时同步
  useEffect(() => {
    if (!value) { setLocalDate(""); return; }
    const d = new Date(value);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setLocalDate(`${yyyy}-${mm}-${dd}`);
  }, [value]);

  const formatDisplay = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const handleChange = async (date: Date | Date[] | string | string[] | undefined) => {
    if (!date) {
      setLocalDate("");
      try { await onSave(""); } catch { Toast.error("截止日期修改失败"); }
      return;
    }
    const d = date instanceof Date ? date : new Date(String(date));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dateStr = `${yyyy}-${mm}-${dd}`;
    setLocalDate(dateStr);
    try {
      await onSave(`${dateStr}T23:59:59${getLocalTZOffset()}`);
    } catch {
      Toast.error("截止日期修改失败");
    }
  };

  const display = formatDisplay(value);

  return (
    <span className="wk-mp-header__ddl wk-mp-header__ddl--editable" ref={ref}>
      <DatePicker
        value={localDate ? fromLocalDateString(localDate) : undefined}
        onChange={handleChange as any}
        disabledDate={(date) => !!date && date < new Date(new Date().setHours(0, 0, 0, 0))}
        density="compact"
        position="bottomLeft"
        triggerRender={() => (
          <span className="wk-mp-header__ddl-trigger">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="wk-mp-header__ddl-label">截止</span>
            <span className="wk-mp-header__ddl-value">
              {display || "未设置"}
            </span>
          </span>
        )}
      />
    </span>
  );
}
