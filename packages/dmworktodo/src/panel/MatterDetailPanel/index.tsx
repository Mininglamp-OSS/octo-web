import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { DatePicker } from "@douyinfe/semi-ui";
import VoiceInputButton from "@octo/base/src/Components/VoiceInputButton";
import type {
  MatterDetail,
  MatterStatus,
  MatterChannel as MatterChannelType,
  TimelineEntry,
  TimelineReq,
  MatterActivity,
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
  listActivities,
} from "../../api/todoApi";
import { getMessageByChannel } from "../../api/imMessageApi";
import { Toast } from "../../utils/toast";
import { toParentGroupNo } from "../../utils/channelId";
import UserName from "../../ui/UserName";
import LinkChannelsModal from "../../ui/LinkChannelsModal";
import type { ChannelOption } from "../../ui/LinkChannelsModal";
import OwnerEditor from "../../ui/OwnerEditor";
import AnchorPopover from "../../ui/AnchorPopover";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { Channel, ChannelTypePerson } from "wukongimjssdk";
import { WKApp } from "@octo/base";
import { ShowConversationOptions } from "@octo/base/src/EndpointCommon";
import { useChannelName } from "../../hooks/useChannelName";
import { useMyGroups } from "../../hooks/useMyGroups";
import {
  useMembersFromChannels,
  ChannelRef,
} from "../../hooks/useMembersFromChannels";
import { useUserName, useUserNames } from "../../hooks/useUserName";
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
    "channels" | "changelog"
  >("channels");

  // Timeline
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [expandedTimelines, setExpandedTimelines] = useState<Set<string>>(
    new Set(),
  );
  // "查看原消息上下文" 弹框状态: 记录要查的消息 id 列表 + 所在 channel +
  // 触发按钮的屏幕坐标 (x/y), 用于 popover 锚定到按钮下方而不是居中。
  const [anchor, setAnchor] = useState<{
    channelId: string;
    channelType: number;
    channelName: string;
    messageIds: string[];
    x: number;
    y: number;
  } | null>(null);
  // 拉取 timeline (matter 加载时 + 每次展开时都调, 保证数据新鲜)。
  //
  // 后端 GET /matters/:id/timeline 支持 source_channel_id 查询参数
  // (todos/internal/service/timeline_svc.go:25 "filters by
  // matter_timelines.source_channel_id when non-empty"):
  //   - 传: 只返回该群的 timeline 条目 (服务端 WHERE 过滤, 省带宽)
  //   - 不传: 返回整个 Matter 下全量 timeline
  //
  // 调用方:
  //   - 展开某群卡片时传 sourceChannelId, 只拉本群的条目 (省带宽)
  //   - matter 加载 + 变更记录 tab 不传, 拿全量用于计数和分群
  //
  // 合并策略: 传 sourceChannelId 时拿到的是子集, 不能覆盖已有的其他群
  // 数据。按 entry.id 做去重合并: 本次结果 + 历史里不属于本群的条目
  // (本群的历史条目让新数据替代, 保证新鲜)。不传时是全量, 直接覆盖。
  const loadTimeline = useCallback(
    async (sourceChannelId?: string) => {
      if (!matterId) {
        setTimeline([]);
        return;
      }
      setTimelineLoading(true);
      try {
        const params: { limit: number; source_channel_id?: string } = {
          limit: 50,
        };
        if (sourceChannelId) params.source_channel_id = sourceChannelId;
        const res = await listTimeline(matterId, params);
        const fresh = res.data || [];
        if (sourceChannelId) {
          // 子集响应: 保留 state 里其他群的条目, 用 fresh 替换本群的
          setTimeline((prev) => {
            const keep = prev.filter(
              (e) => e.source_channel_id !== sourceChannelId,
            );
            return [...keep, ...fresh];
          });
        } else {
          // 全量响应: 直接覆盖
          setTimeline(fresh);
        }
      } catch {
        if (!sourceChannelId) setTimeline([]);
        // 子集请求失败时不清空别人的数据
      } finally {
        setTimelineLoading(false);
      }
    },
    [matterId],
  );
  const toggleTimeline = useCallback(
    (chId: string) => {
      setExpandedTimelines((prev) => {
        const next = new Set(prev);
        if (next.has(chId)) {
          next.delete(chId);
        } else {
          next.add(chId);
          // 展开时按本群过滤拉 (source_channel_id), 减少带宽。
          // chId 这里是 matter_channels.channel_id, 也就是真实 IM 群号,
          // 跟后端 timeline_entries.source_channel_id 同一份数据。
          loadTimeline(chId);
        }
        return next;
      });
    },
    [loadTimeline],
  );
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  // Activities (变更记录): matter-level 审计日志。每次 matter 字段变更
  // (title / description / status / assignee / channel 等) 后端会 record,
  // 前端在 matter 加载时 + 每次 applyMatterUpdate 广播 wk:matter-updated 后
  // 重新拉取, 保证 tab count + 列表都新鲜。
  const [activities, setActivities] = useState<MatterActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const loadActivities = useCallback(async () => {
    if (!matterId) {
      setActivities([]);
      return;
    }
    setActivitiesLoading(true);
    try {
      const res = await listActivities(matterId, { limit: 100 });
      setActivities(res.data || []);
    } catch {
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, [matterId]);
  useEffect(() => {
    loadActivities();
  }, [loadActivities]);
  // 订阅 wk:matter-updated: 当前面板自己 apply 更新或其他路径修改同一 matter
  // 时都会触发, 需要重拉 activities 刷新 tab count 和列表。
  useEffect(() => {
    if (!matterId) return;
    const handler = (data: { matterId: string }) => {
      if (data?.matterId === matterId) loadActivities();
    };
    WKApp.mittBus.on("wk:matter-updated", handler);
    return () => {
      WKApp.mittBus.off("wk:matter-updated", handler);
    };
  }, [matterId, loadActivities]);

  // 每个 channel 的最新一条 timeline 条目 (用于 "最新进展" 展示)。
  // matter 加载后并发对每个关联 channel 调 listTimeline(limit=1),
  // 有数据 → 渲染 content; 无数据 → 隐藏 "最新进展" 块。
  const [latestByChannel, setLatestByChannel] = useState<
    Map<string, TimelineEntry>
  >(new Map());

  // matter 加载完成后, 并发拉每个 channel 的最新 1 条 timeline
  useEffect(() => {
    if (!matter) {
      setLatestByChannel(new Map());
      return;
    }
    const chs = matter.channels || [];
    if (chs.length === 0) {
      setLatestByChannel(new Map());
      return;
    }
    let aborted = false;
    Promise.all(
      chs.map(async (ch) => {
        try {
          const res = await listTimeline(matter.id, {
            source_channel_id: ch.channel_id,
            limit: 1,
          });
          const first = res.data?.[0];
          return { channelId: ch.channel_id, entry: first || null };
        } catch {
          return { channelId: ch.channel_id, entry: null };
        }
      }),
    ).then((results) => {
      if (aborted) return;
      const map = new Map<string, TimelineEntry>();
      for (const r of results) {
        if (r.entry) map.set(r.channelId, r.entry);
      }
      setLatestByChannel(map);
    });
    return () => {
      aborted = true;
    };
    // matter.id + channels 变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matter?.id, matter?.channels?.length]);

  // 成功变更 matter 后统一调用: 本地 state 刷新 + 广播事件让左侧列表 reload。
  // MatterDetailPanel 挂在 routeRight, 左侧 sidebar 列表挂在 routeLeft,
  // 两个 React 子树不共享 state, 必须靠 mittBus 事件解耦通知。
  //
  // 合并策略: 后端 PUT /matters/:id 返回的 updated 可能不包含关联数据
  // (channels / assignees 等), 直接覆盖会导致这些 UI 闪空。保守合并:
  // updated 字段优先; updated 缺失时保留 prev, 避免丢失。
  const applyMatterUpdate = useCallback((updated: MatterDetail) => {
    setMatter((prev) => {
      if (!prev) return updated;
      return {
        ...prev,
        ...updated,
        // 关联数据优先取 updated 里的 (如果有), 否则保留 prev
        channels: updated.channels ?? prev.channels,
        assignees: updated.assignees ?? prev.assignees,
        participants: updated.participants ?? prev.participants,
      };
    });
    WKApp.mittBus.emit("wk:matter-updated", { matterId: updated.id });
  }, []);

  // Fetch matter
  useEffect(() => {
    if (!matterId) {
      setMatter(null);
      return;
    }
    let stale = false;
    setLoading(true);
    setError(null);
    getMatter(matterId, channelId || undefined)
      .then((data) => { if (!stale) setMatter(data); })
      .catch((err) => {
        if (!stale) {
          setError(err?.message || "加载失败");
          setMatter(null);
        }
      })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
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
        applyMatterUpdate(updated);
      } catch (err: any) {
        setMatter((prev) => (prev ? { ...prev, status: oldStatus } : prev));
        const msg = err?.message || "状态修改失败";
        if (msg.includes("only creator")) {
          Toast.error("仅创建人可以归档/取消归档");
        } else {
          Toast.error(msg);
        }
      }
    },
    [matter, applyMatterUpdate],
  );

  const handleDeleteMatter = useCallback(async () => {
    if (!matter) return;
    if (!window.confirm(`确定删除事项「${matter.title}」？此操作不可恢复。`))
      return;
    try {
      await deleteMatter(matter.id);
      WKApp.mittBus.emit("wk:matter-deleted", { matterId: matter.id });
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
    applyMatterUpdate(updated);
  }, [matter, applyMatterUpdate]);

  // ── 取消关联群聊 ──
  const handleUnlinkChannel = useCallback(
    async (chId: string) => {
      if (!matter) return;
      if (!window.confirm("确定取消关联此频道？")) return;
      try {
        await unlinkChannel(matter.id, chId);
        const updated = await getMatter(matter.id);
        applyMatterUpdate(updated);
        Toast.success("已取消关联");
      } catch {
        Toast.error("取消关联失败");
      }
    },
    [matter, applyMatterUpdate],
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
        const code = e?.code;
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
        applyMatterUpdate(updated);
      } catch (err: any) {
        const msg =
          err?.message ||
          (isCurrentlyAssigned ? "移除负责人失败" : "添加负责人失败");
        Toast.error(msg);
      }
    },
    [matter, applyMatterUpdate],
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

  // 拉取当前用户加入的所有群, 用于判断 Matter 关联群聊里哪些是我没加入的:
  //   - 没加入的群: 群名模糊展示, 时间线条目不展示 "↗ 原消息" (权限不允许)
  //   - 拉取失败时 failed=true, 保守处理成 "全部未加入" (宁可多遮)
  const { groupNos: myGroupNos, loading: myGroupsLoading, failed: myGroupsFailed } = useMyGroups();

  // ── UI/数据分离: 为 ui/ 组件提供 renderAvatar / renderUserName ──
  const renderAvatar = useCallback(
    (uid: string, size: number) => (
      <WKAvatar
        channel={new Channel(uid, ChannelTypePerson)}
        style={{ width: size, height: size }}
      />
    ),
    [],
  );
  const renderUserName = useCallback(
    (uid: string) => <UserName uid={uid} />,
    [],
  );

  // ── OwnerEditor: 候选成员来源 channel 列表 (hook 必须在 early return 前) ──
  const ownerCandidateChannelRefs: ChannelRef[] = useMemo(() => {
    const seen = new Set<string>();
    const list: ChannelRef[] = [];
    const push = (id: string | undefined | null, type: number | undefined | null) => {
      if (!id || type === undefined || type === null) return;
      const key = `${id}:${type}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ channelId: id, channelType: type });
    };
    for (const ch of matter?.channels || []) {
      push(ch.channel_id, ch.channel_type);
    }
    if (matter) push(matter.source_channel_id, matter.source_channel_type);
    return list;
  }, [matter?.channels, matter?.source_channel_id, matter?.source_channel_type]);

  const { members: ownerCandidateMembers } = useMembersFromChannels(
    ownerCandidateChannelRefs,
    { enabled: true },
  );

  // 合并 assignees + members 为 OwnerEditor 的 candidates prop
  const ownerCandidates = useMemo(() => {
    const seen = new Set<string>();
    const list: Array<{ uid: string; name?: string }> = [];
    for (const a of matter?.assignees || []) {
      if (seen.has(a.user_id)) continue;
      seen.add(a.user_id);
      list.push({ uid: a.user_id });
    }
    for (const m of ownerCandidateMembers) {
      if (seen.has(m.uid)) continue;
      seen.add(m.uid);
      list.push({ uid: m.uid, name: m.name });
    }
    return list;
  }, [matter?.assignees, ownerCandidateMembers]);

  // 候选池里已有 name 的 uid 直接用, 只对 assignees 里缺名的 uid 调 useUserNames
  // 避免把整个候选池 (可能数百人) 全量传给 fetchChannelInfo
  const candidateNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of ownerCandidates) {
      if (c.name) m.set(c.uid, c.name);
    }
    return m;
  }, [ownerCandidates]);

  const assigneeUidsNeedingName = useMemo(
    () =>
      (matter?.assignees || [])
        .map((a) => a.user_id)
        .filter((uid) => !candidateNameMap.has(uid)),
    [matter?.assignees, candidateNameMap],
  );
  const assigneeNameMap = useUserNames(assigneeUidsNeedingName);

  const resolveOwnerName = useCallback(
    (uid: string) =>
      candidateNameMap.get(uid) || assigneeNameMap.get(uid) || "",
    [candidateNameMap, assigneeNameMap],
  );

  // ── LinkChannelsModal: loadChannels / onLinkChannel callbacks ──
  const loadChannelsForModal = useCallback(async (): Promise<ChannelOption[]> => {
    const groups = await WKApp.dataSource.channelDataSource.groupSaveList();
    return (groups as any[]).map((g: any) => ({
      channelId: g.channel?.channelID || g.channel_id || "",
      channelType: g.channel?.channelType || 2,
      name: g.title || g.name || "",
      desc: g.remark || g.desc || "",
      memberCount: g.memberCount || g.member_count || undefined,
    }));
  }, []);

  const handleLinkChannelSubmit = useCallback(
    async (mId: string, chId: string, chType: number, chName: string) => {
      await linkChannel(mId, {
        channel_id: chId,
        channel_type: chType,
        channel_name: chName,
      });
    },
    [],
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

  // 头部 "关联新群" 按钮的权限: 先沿用 canEditOwner (发起人 + 负责人 可见)。
  // PRD §5.2 要点 [3] 允许关联成员多选关联 / 一键拉群, 但那是 IM 多选触发
  // 的路径; 详情页头部这个入口的可见性目前跟 '能改负责人' 一致, 防止关联
  // 成员在详情页直接加群 (走 IM 多选路径更可控)。要放宽的话把 canForward
  // 改成 true 即可, 不影响后端权限 (后端仍然按发起/负责/参与者判)。
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

  // 来源群成员判断: 跟关联群卡片同逻辑, 用 toParentGroupNo + myGroupNos 判断
  const isSourceMember = (() => {
    if (!matter.source_channel_id) return true; // 无来源群, 不限制
    if (myGroupsFailed) return false; // 拉取失败保守处理
    const parentNo = toParentGroupNo(
      matter.source_channel_id,
      matter.source_channel_type || 2,
    );
    return myGroupNos.has(parentNo);
  })();

  const tabs: {
    id: "channels" | "changelog";
    label: string;
    count: number;
  }[] = [
    { id: "channels", label: "关联群聊", count: channels.length },
    { id: "changelog", label: "变更记录", count: activities.length },
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
              canEditStatus={canEditOwner}
            />
            <EditableDeadline
              value={matter.deadline || null}
              onSave={async (newVal) => {
                const updated = await updateMatter(matter.id, {
                  deadline: newVal || "",
                });
                applyMatterUpdate(updated);
              }}
            />
            {canForward && (
              <button
                type="button"
                className="wk-mp-header__action"
                title="关联新群"
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
              applyMatterUpdate(updated);
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
              applyMatterUpdate(updated);
            }}
          />
          {matter.source_channel_id && (
            <div
              className={`wk-mp-goal__source${!myGroupsLoading && isSourceMember && matter.source_msgs && matter.source_msgs.length > 0 ? " wk-mp-goal__source--clickable" : ""}`}
              onClick={(ev) => {
                if (!myGroupsLoading && isSourceMember && matter.source_msgs && matter.source_msgs.length > 0) {
                  const rect = ev.currentTarget.getBoundingClientRect();
                  setAnchor({
                    channelId: matter.source_channel_id!,
                    channelType: matter.source_channel_type || 0,
                    channelName: displaySourceName,
                    messageIds: matter.source_msgs,
                    ...computeAnchorPosition(rect),
                  });
                }
              }}
              title={
                myGroupsLoading
                  ? "正在加载群信息..."
                  : isSourceMember && matter.source_msgs && matter.source_msgs.length > 0
                    ? "点击查看原消息上下文"
                    : !isSourceMember
                      ? "您未加入该群"
                      : undefined
              }
              style={
                !myGroupsLoading && isSourceMember && matter.source_msgs && matter.source_msgs.length > 0
                  ? { cursor: "pointer" }
                  : undefined
              }
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
              {myGroupsLoading ? (
                <span className="wk-mp-goal__source-skeleton" aria-label="加载中">
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </span>
              ) : isSourceMember ? (
                <span>来自 #{displaySourceName}</span>
              ) : (
                <span style={{ filter: "blur(2.5px)", opacity: 0.35, userSelect: "none", transition: "filter 0.3s ease, opacity 0.3s ease" }}>来自 #████</span>
              )}
              {!myGroupsLoading && isSourceMember && matter.source_msgs && matter.source_msgs.length > 0 && (
                <span className="wk-mp-goal__source-anchor">↗</span>
              )}
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
                currentUid={currentUid || ""}
                isCreator={matter.creator_id === currentUid}
                candidates={ownerCandidates}
                onToggle={handleToggleAssignee}
                renderAvatar={renderAvatar}
                resolveUserName={resolveOwnerName}
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
              {canForward && (
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
              )}
            </div>
            {channels.length === 0 ? (
              <div className="wk-mp-channels__empty">暂无关联群聊</div>
            ) : (
              channels.map((ch) => {
                // 用户是否加入本群: 从 /group/my 拉的 group_no 集合判断。
                // 拉取失败 (myGroupsFailed) 时保守当成未加入, 宁可多遮。
                //
                // 子区 (channel_type=5) 的 channel_id 是 "父群号____short_id"
                // 拼接而成, /group/my 只返回群 (type=2) 不返回子区, 必须用
                // 父群号去匹配。toParentGroupNo 已处理: 群类型原样返回,
                // 子区拆 '____' 取前半段。
                const parentGroupNo = toParentGroupNo(
                  ch.channel_id,
                  ch.channel_type,
                );
                const isMember =
                  !myGroupsFailed && myGroupNos.has(parentGroupNo);
                return (
                <div key={ch.id} className="wk-mp-channels__card">
                  <div className="wk-mp-channels__card-head">
                    <span className="wk-mp-channels__card-name">
                      #
                      <ChannelNameLabel
                        channelId={ch.channel_id}
                        channelType={ch.channel_type}
                        fallback={ch.channel_name}
                        blur={!isMember}
                        loading={myGroupsLoading}
                      />
                    </span>
                    {!myGroupsLoading && !isMember && <NotMemberBadge />}
                    <span className="wk-mp-channels__card-time">
                      {new Date(ch.created_at).toLocaleDateString("zh-CN", {
                        month: "numeric",
                        day: "numeric",
                      })}{" "}
                      关联
                    </span>
                    {/* 查看群聊菜单: 仅群成员可见 (非成员无权限查看群聊) */}
                    {isMember && (
                      <ChannelMoreMenu
                        channelId={ch.channel_id}
                        channelType={ch.channel_type}
                        onUnlink={() => handleUnlinkChannel(ch.channel_id)}
                      />
                    )}
                  </div>
                  {/* 最新进展: 有 timeline 条目时显示最新一条 content,
                      没有时整块隐藏。非成员不展示 (信息隔离) */}
                  {isMember && latestByChannel.has(ch.channel_id) && (
                    <div className="wk-mp-channels__card-progress">
                      <div className="wk-mp-channels__card-progress-label">
                        最新进展
                      </div>
                      <div className="wk-mp-channels__card-progress-text">
                        {latestByChannel.get(ch.channel_id)!.content ||
                          "（无文本内容）"}
                      </div>
                    </div>
                  )}
                  {/* 展开时间线: 仅成员可见, 非成员无权查看群消息衍生内容 */}
                  {isMember && (<>
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
                      // 按 source_channel_id 匹配 (这是真实 IM group_no,
                      // 跟 matter_channel.channel_id 同一份数据)。
                      // timeline.channel_id 是 matter_channels 表的 UUID,
                      // 跟外层 ch.channel_id (真实群号) 类型完全不同,
                      // 曾经有同名字段误以为可以直接比对 (PR #xxx 修复)。
                      const chEntries = timeline.filter(
                        (e) =>
                          e.source_channel_id === ch.channel_id ||
                          (!e.source_channel_id && !e.channel_id),
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
                          // 未加入该群时整个群的 entries 都不允许看原消息,
                          // 用 canShowAnchor 彻底隐藏按钮 (不是置灰),
                          // 对齐原型 v19 V5_TimelinePanel 里 isMember &&
                          // SourceTag 的 short-circuit 行为。
                          canShowAnchor={() => isMember}
                          onShowAnchor={
                            isMember
                              ? (entry, ev) => {
                                  const rect =
                                    ev.currentTarget.getBoundingClientRect();
                                  setAnchor({
                                    channelId: ch.channel_id,
                                    channelType: ch.channel_type,
                                    channelName:
                                      ch.channel_name ||
                                      ch.channel_id.slice(0, 8),
                                    messageIds: entry.source_msgs || [],
                                    ...computeAnchorPosition(rect),
                                  });
                                }
                              : undefined
                          }
                        />
                      );
                    })()}
                  </>)}
                </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Tab: 变更记录 (activities) ── */}
        {activeTab === "changelog" && (
          <ActivityPanel
            activities={activities}
            loading={activitiesLoading}
          />
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
        loadChannels={loadChannelsForModal}
        onLinkChannel={handleLinkChannelSubmit}
      />

      {/* 原消息上下文弹框 */}
      {anchor && (
        <AnchorPopover
          channelId={anchor.channelId}
          channelType={anchor.channelType}
          channelName={anchor.channelName}
          messageIds={anchor.messageIds}
          x={anchor.x}
          y={anchor.y}
          onClose={() => setAnchor(null)}
          fetchMessage={getMessageByChannel}
          renderAvatar={renderAvatar}
          renderUserName={renderUserName}
          onJumpToMessage={(messageSeq) => {
            // 跳转到群聊并定位到指定消息
            const channel = new Channel(anchor.channelId, anchor.channelType);
            const opts = new ShowConversationOptions();
            opts.initLocateMessageSeq = messageSeq;
            WKApp.endpoints.showConversation(channel, opts);
          }}
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
  canEditStatus,
}: {
  status: MatterStatus;
  onChange: (s: MatterStatus) => void;
  isCreator: boolean;
  canEditStatus: boolean;
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
  const isDisabled = isArchived || !canEditStatus;

  return (
    <span className="wk-mp-status-wrap" ref={ref}>
      <button
        type="button"
        className={`wk-mp-pill ${current.cls}`}
        onClick={() => {
          if (!isDisabled) setOpen(!open);
        }}
        title={
          isArchived
            ? "已归档事项不可修改状态"
            : !canEditStatus
              ? "仅发起人或负责人可修改状态"
              : "点击修改状态"
        }
        style={isDisabled ? { cursor: "not-allowed", opacity: 0.8 } : undefined}
        disabled={isDisabled}
      >
        <span className="wk-mp-pill__dot" />
        {current.label}
      </button>
      {open && !isDisabled && (
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

function ChannelMoreMenu({
  channelId,
  channelType,
  onUnlink,
}: {
  channelId: string;
  channelType: number;
  onUnlink: () => void;
}) {
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

  const handleViewChannel = () => {
    setOpen(false);
    // 跳转到群聊
    const channel = new Channel(channelId, channelType);
    WKApp.endpoints.showConversation(channel);
  };

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
            onClick={handleViewChannel}
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
          {/* 取消关联暂时隐藏，后续产品确认后恢复 */}
        </div>
      )}
    </span>
  );
}

// ─── TimelinePanel (群内事件时间线 — 对齐原型 v19 真实 UI) ──

/**
 * 根据触发按钮的 rect 算 AnchorPopover 锚定位置 (对齐原型 v19 onShowAnchor):
 *   - 水平: 左对齐按钮, 防止弹框太靠右
 *   - 垂直: 按钮下方 8px, 优先向下展开，空间不足时向上展开
 *
 * 返回 viewport 坐标 (fixed 定位用)。调用方把 x/y 传进 AnchorPopover。
 */
function computeAnchorPosition(rect: DOMRect): { x: number; y: number } {
  const POP_WIDTH = 420;
  const POP_HEIGHT = 360;
  const SAFE = 16;
  const GAP = 8; // 按钮与弹框的间距

  // 优先左对齐按钮，如果右侧空间不足则向左移动
  const x = Math.max(
    SAFE,
    Math.min(rect.left, window.innerWidth - POP_WIDTH - SAFE),
  );

  // 计算垂直位置：优先向下展开，空间不足时向上展开
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  let y: number;
  if (spaceBelow >= POP_HEIGHT + GAP) {
    // 下方空间充足，向下展开
    y = rect.bottom + GAP;
  } else if (spaceAbove >= POP_HEIGHT + GAP) {
    // 上方空间充足，向上展开
    y = rect.top - POP_HEIGHT - GAP;
  } else {
    // 两侧空间都不足，居中显示并限制在安全范围内
    y = Math.max(SAFE, Math.min(
      rect.top - POP_HEIGHT / 2 + rect.height / 2,
      window.innerHeight - POP_HEIGHT - SAFE
    ));
  }

  return { x, y };
}

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
  canShowAnchor,
}: {
  entries: TimelineEntry[];
  /**
   * 点击 "查看原消息上下文" 时调用, 由父组件负责弹 AnchorPopover。
   * 不传: 按钮 disabled (无法查看, 通常是条目没有 source_msgs 字段)。
   * event 用来拿按钮 boundingClientRect, 把 popover 锚定到按钮附近。
   */
  onShowAnchor?: (entry: TimelineEntry, event: React.MouseEvent) => void;
  /**
   * 可选: 逐条判断某 entry 是否允许 "查看原消息" (典型场景: 当前用户
   * 不在该条 entry 所属 channel, 没权限拉原消息)。
   * 返回 false 时该条不显示原消息按钮, 即使 source_msgs 非空。
   * 不传 = 默认所有条都允许 (由 onShowAnchor + source_msgs 决定)。
   */
  canShowAnchor?: (entry: TimelineEntry) => boolean;
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
                  {/* ↗ 原消息: 
                      - entry 没有 source_msgs → 置灰 (保持原按钮占位, 避免
                        其它条目对不齐) 
                      - 调用方用 canShowAnchor 否决 (典型: 用户不在该条
                        entry 所属 channel, 没权限查原消息) → 整个按钮不渲染 */}
                  {(() => {
                    const anchorAllowed =
                      !canShowAnchor || canShowAnchor(e);
                    if (!anchorAllowed) return null;
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
                        onClick={(ev) => {
                          if (hasSource && onShowAnchor) onShowAnchor(e, ev);
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

// ─── ChannelNameLabel (实时反查群名, 避免显示空或 ID 前缀) ──
//
// 跟顶层 liveSourceName 同构, 但这里要在 channels.map 里每项独立 hook,
// 必须拆成子组件 (Rules of Hooks: hook 不能放循环里)。
//
// 优先级: WKSDK 反查最新群名 > 后端保存的 channel_name 快照 > id 前缀兜底
// 群改名后 WKSDK cache 会推新值, 组件自动重渲染。

function ChannelNameLabel({
  channelId,
  channelType,
  fallback,
  blur,
  loading,
}: {
  channelId: string;
  channelType: number;
  fallback?: string;
  /**
   * 未加入群时传 true: 用固定 4 字符占位 + CSS 模糊展示, 防止
   * 名字长度本身泄漏信息。占位选 U+2588 FULL BLOCK, 视觉上明确是
   * 被遮罩的内容。
   */
  blur?: boolean;
  /**
   * 成员关系拉取中传 true: 显示 shimmer 骨架占位, 避免在权限未知时
   * 先渲染模糊或明文群名造成误导。跟"先模糊再清晰"的闪烁体验相比,
   * 骨架占位更稳重, 也对慢网络更友好。
   */
  loading?: boolean;
}) {
  const live = useChannelName(channelId, channelType);
  if (loading) {
    return (
      <span
        className="wk-mp-channels__card-name--skeleton"
        aria-label="加载中"
        role="presentation"
      >
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      </span>
    );
  }
  if (blur) {
    return (
      <span
        className="wk-mp-channels__card-name--blur"
        title="你不在该群, 群名已隐藏"
        aria-label="群名已隐藏"
      >
        ████
      </span>
    );
  }
  const display = live || fallback || channelId.slice(0, 8);
  return <span className="wk-mp-channels__card-name--clear">{display}</span>;
}

// ─── NotMemberBadge (对齐原型 v19: '不在群' 小徽章) ──
//
// 原型里用户不在该群时, 群名照常显示 (让用户知道是哪个群), 但旁边
// 跟一个灰底带小锁的 '不在群' 徽章标明权限状态。避免 blur 群名那种
// "看不清是啥群" 的困惑。
function NotMemberBadge() {
  return (
    <span className="wk-mp-channels__not-member-badge">
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      不在群
    </span>
  );
}

// ─── ActivityPanel (变更记录 — 对接 GET /matters/:id/activities) ──

const ACTION_LABELS: Record<string, string> = {
  created: "创建",
  title_changed: "标题变更",
  description_changed: "目标变更",
  deadline_changed: "截止日期变更",
  status_changed: "状态变更",
  assignee_added: "添加负责人",
  assignee_removed: "移除负责人",
  channel_linked: "关联群聊",
  channel_unlinked: "取消关联",
};

function formatActivityTime(iso: string): string {
  const d = new Date(iso);
  const mm = `${d.getMonth() + 1}/${d.getDate()}`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm} ${hh}:${mi}`;
}

function ActivityContent({ activity }: { activity: MatterActivity }) {
  const detail = activity.detail || {};
  switch (activity.action) {
    case "created":
      return <span>创建了事项</span>;
    case "title_changed":
      return (
        <span>
          <span className="wk-mp-activity__old">
            {(detail.from as string) || ""}
          </span>
          {" → "}
          <span className="wk-mp-activity__new">
            {(detail.to as string) || ""}
          </span>
        </span>
      );
    case "description_changed":
      return (
        <span>{(detail.summary as string) || "更新了描述"}</span>
      );
    case "deadline_changed": {
      const from = detail.from
        ? new Date((detail.from as number) * 1000).toLocaleDateString("zh-CN")
        : "无";
      const to = detail.to
        ? new Date((detail.to as number) * 1000).toLocaleDateString("zh-CN")
        : "无";
      return (
        <span>
          <span className="wk-mp-activity__old">{from}</span>
          {" → "}
          <span className="wk-mp-activity__new">{to}</span>
        </span>
      );
    }
    case "status_changed":
      return (
        <span>
          <span className="wk-mp-activity__old">
            {(detail.from as string) || ""}
          </span>
          {" → "}
          <span className="wk-mp-activity__new">
            {(detail.to as string) || ""}
          </span>
        </span>
      );
    case "assignee_added":
      return (
        <span>
          添加 <UserName uid={(detail.user_id as string) || ""} />
        </span>
      );
    case "assignee_removed":
      return (
        <span>
          移除 <UserName uid={(detail.user_id as string) || ""} />
        </span>
      );
    case "channel_linked":
      return (
        <span>
          关联 #{(detail.channel_name as string) || (detail.channel_id as string) || ""}
        </span>
      );
    case "channel_unlinked":
      return (
        <span>
          取消关联 #{(detail.channel_id as string) || ""}
        </span>
      );
    default:
      return <span>{activity.action}</span>;
  }
}

function ActivityPanel({
  activities,
  loading,
}: {
  activities: MatterActivity[];
  loading: boolean;
}) {
  const [sortNewest, setSortNewest] = useState(true);
  const [filter, setFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const close = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node))
        setFilterOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [filterOpen]);

  const filtered =
    filter === "all"
      ? activities
      : activities.filter((a) => a.action === filter);
  const sorted = [...filtered].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return sortNewest ? tb - ta : ta - tb;
  });

  const FILTER_OPTIONS = [
    { id: "all", label: "全部类型" },
    { id: "created", label: "创建" },
    { id: "title_changed", label: "标题变更" },
    { id: "description_changed", label: "目标变更" },
    { id: "deadline_changed", label: "DDL 变更" },
    { id: "status_changed", label: "状态变更" },
    { id: "channel_linked", label: "关联群变更" },
    { id: "channel_unlinked", label: "关联群变更" },
  ];
  const currentFilter =
    FILTER_OPTIONS.find((o) => o.id === filter) || FILTER_OPTIONS[0];

  return (
    <div className="wk-mp-tl">
      {/* Header: 排序 + 筛选 */}
      <div className="wk-mp-activity__toolbar">
        <div className="wk-mp-tl__sort-group">
          <button
            type="button"
            className={`wk-mp-tl__sort-btn${sortNewest ? " is-active" : ""}`}
            onClick={() => setSortNewest(true)}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="6" x2="9" y2="6" />
              <line x1="3" y1="12" x2="15" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            最旧在上
          </button>
        </div>
        {/* 类型筛选 */}
        <span className="wk-mp-activity__filter-wrap" ref={filterRef}>
          <button
            type="button"
            className="wk-mp-activity__filter-btn"
            onClick={() => setFilterOpen((o) => !o)}
          >
            <span>{currentFilter.label}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {filterOpen && (
            <div className="wk-mp-activity__filter-dropdown">
              {FILTER_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`wk-mp-activity__filter-item${o.id === filter ? " is-active" : ""}`}
                  onClick={() => {
                    setFilter(o.id);
                    setFilterOpen(false);
                  }}
                >
                  {o.label}
                  {o.id === filter && <span>✓</span>}
                </button>
              ))}
            </div>
          )}
        </span>
      </div>

      {loading && <div className="wk-mp-empty-tab">加载中...</div>}
      {!loading && sorted.length === 0 && (
        <div className="wk-mp-empty-tab">暂无变更记录</div>
      )}
      {!loading &&
        sorted.map((a) => {
          const isGoal = a.action === "description_changed";
          return (
            <div
              key={a.id}
              className={`wk-mp-activity__row${isGoal ? " wk-mp-activity__row--goal" : ""}`}
            >
              <span className="wk-mp-activity__time">
                {formatActivityTime(a.created_at)}
              </span>
              <span
                className={`wk-mp-activity__label${isGoal ? " wk-mp-activity__label--goal" : ""}`}
              >
                {ACTION_LABELS[a.action] || a.action}
              </span>
              <span className="wk-mp-activity__content">
                <ActivityContent activity={a} />
              </span>
              <span className="wk-mp-activity__actor">
                <WKAvatar
                  channel={new Channel(a.actor_id, ChannelTypePerson)}
                  style={{ width: 14, height: 14 }}
                />
                <UserName uid={a.actor_id} />
              </span>
            </div>
          );
        })}
    </div>
  );
}

// ─── TimelineInput (添加进展) ─────────────────────────────

function TimelineInput({ onSubmit }: { onSubmit: (content: string) => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = () => {
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
  };
  return (
    <div className="wk-mp-tl-input">
      <input
        ref={inputRef}
        type="text"
        className="wk-mp-tl-input__field"
        placeholder="添加进展或评论..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
        }}
      />
      <VoiceInputButton
        inputRef={inputRef}
        onTranscribed={(text, mode, savedRange) => {
          if (mode === "all") {
            setValue(text);
          } else if (mode === "selection" && savedRange) {
            // Note: savedRange indices are from recording start; assumes input is read-only during recording
            setValue((prev) => prev.slice(0, savedRange.from) + text + prev.slice(savedRange.to));
          } else {
            setValue((prev) => {
              const pos = savedRange?.from ?? prev.length;
              return prev.slice(0, pos) + text + prev.slice(pos);
            });
          }
        }}
        size="sm"
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
  const containerRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, []);

  const cancelPendingCommit = () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };

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
      <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
        <input
          ref={inputRef}
          className="wk-mp-header__title wk-mp-header__title--editing"
          value={draft}
          maxLength={500}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            cancelPendingCommit();
            commitTimerRef.current = setTimeout(commit, 200);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { cancelPendingCommit(); commit(); }
            if (e.key === "Escape") {
              cancelPendingCommit();
              setDraft(value);
              setEditing(false);
            }
          }}
        />
        <VoiceInputButton
          inputRef={inputRef}
          onRecordingStart={cancelPendingCommit}
          onTranscribed={(text, mode, savedRange) => {
            cancelPendingCommit();
            let newValue: string;
            if (mode === "all") {
              newValue = text;
            } else if (mode === "selection" && savedRange) {
              // Note: savedRange indices are from recording start; assumes input is read-only during recording
              newValue = draft.slice(0, savedRange.from) + text + draft.slice(savedRange.to);
            } else {
              const pos = savedRange?.from ?? draft.length;
              newValue = draft.slice(0, pos) + text + draft.slice(pos);
            }
            setDraft(newValue.slice(0, 500));
            // Refocus so next click-away triggers blur → commit
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          getCurrentText={() => draft}
          showModeMenu
          size="sm"
        />
      </div>
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
  const containerRef = useRef<HTMLDivElement>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    };
  }, []);

  const cancelPendingCommit = () => {
    if (commitTimerRef.current) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
  };

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
      <div ref={containerRef} style={{ position: "relative" }}>
        <textarea
          ref={textareaRef}
          className="wk-mp-goal__text wk-mp-goal__text--editing"
          value={draft}
          maxLength={10000}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onBlur={(e) => {
            if (containerRef.current?.contains(e.relatedTarget as Node)) return;
            cancelPendingCommit();
            commitTimerRef.current = setTimeout(commit, 200);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              cancelPendingCommit();
              setDraft(value);
              setEditing(false);
            }
          }}
        />
        <VoiceInputButton
          inputRef={textareaRef}
          onRecordingStart={cancelPendingCommit}
          onTranscribed={(text, mode, savedRange) => {
            cancelPendingCommit();
            let newValue: string;
            if (mode === "all") {
              newValue = text;
            } else if (mode === "selection" && savedRange) {
              // Note: savedRange indices are from recording start; assumes input is read-only during recording
              newValue = draft.slice(0, savedRange.from) + text + draft.slice(savedRange.to);
            } else {
              const pos = savedRange?.from ?? draft.length;
              newValue = draft.slice(0, pos) + text + draft.slice(pos);
            }
            setDraft(newValue.slice(0, 10000));
            // Refocus so next click-away triggers blur → commit
            setTimeout(() => textareaRef.current?.focus(), 0);
          }}
          getCurrentText={() => draft}
          showModeMenu
          size="sm"
          className="wk-vib--textarea-corner"
        />
      </div>
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
        autoSwitchDate={false}
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
