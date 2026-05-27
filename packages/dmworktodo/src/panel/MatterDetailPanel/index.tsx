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
import { toParentGroupNo, CHANNEL_TYPE_COMMUNITY_TOPIC } from "../../utils/channelId";
import { buildLinkableChannels } from "../../utils/buildLinkableChannels";
import type { GroupSaveListRow } from "../../utils/buildLinkableChannels";
import UserName from "../../ui/UserName";
import LinkChannelsModal from "../../ui/LinkChannelsModal";
import type {
  ChannelOption,
  LoadChannelsResult,
} from "../../ui/LinkChannelsModal";
import OwnerEditor from "../../ui/OwnerEditor";
import AnchorPopover from "../../ui/AnchorPopover";
import WKAvatar from "@octo/base/src/Components/WKAvatar";
import { Channel, ChannelTypeGroup, ChannelTypePerson } from "wukongimjssdk";
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
  /** 是否显示关闭按钮（嵌入会话页面时为 true） */
  showClose?: boolean;
}

export default function MatterDetailPanel({
  channelId,
  channelType: _channelType,
  matterId,
  onClose,
  showClose = false,
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
  // 触发按钮的屏幕坐标, 用于 popover 锚定到按钮附近 (上方或下方)。
  const [anchor, setAnchor] = useState<{
    channelId: string;
    channelType: number;
    channelName: string;
    messageIds: string[];
    x: number;
    top?: number;
    bottom?: number;
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
  // 颗粒度: 群 (channel_type=Group) + 子区 (channel_type=CommunityTopic)。
  // 详细行为见 utils/buildLinkableChannels.ts (并发, 过滤, 错误收集, 摊平)。
  // 这里只负责把 WKApp 的 dataSource 接进来; helper 是纯函数, 单测在
  // utils/__tests__/buildLinkableChannels.test.ts。
  const loadChannelsForModal = useCallback(
    async (): Promise<LoadChannelsResult> =>
      buildLinkableChannels(
        {
          groupSaveList: async () =>
            (await WKApp.dataSource.channelDataSource.groupSaveList()) as unknown as GroupSaveListRow[],
          threadList: (no, req) =>
            WKApp.dataSource.channelDataSource.threadList(no, req),
        },
        { channelTypeGroup: ChannelTypeGroup },
      ),
    [],
  );

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
      matter.source_channel_type || ChannelTypeGroup,
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
          {showClose ? (
            /* 嵌入模式：标题+状态在第一行，日期在第二行 */
            <>
              <div className="wk-mp-header__left">
                <div className="wk-mp-header__row1">
                  <EditableTitle
                    value={matter.title}
                    prefix={`M-${matter.seq_no}｜`}
                    inline
                    onSave={async (newTitle) => {
                      const updated = await updateMatter(matter.id, { title: newTitle });
                      applyMatterUpdate(updated);
                    }}
                  />
                  <StatusPicker
                    status={matter.status}
                    onChange={handleStatusChange}
                    isCreator={matter.creator_id === WKApp.loginInfo.uid}
                    canEditStatus={canEditOwner}
                  />
                </div>
                <div className="wk-mp-header__row2">
                  <EditableDeadline
                    value={matter.deadline || null}
                    onSave={async (newVal) => {
                      const updated = await updateMatter(matter.id, {
                        deadline: newVal || "",
                      });
                      applyMatterUpdate(updated);
                    }}
                  />
                </div>
              </div>
              <div className="wk-mp-header__actions">
                <button
                  type="button"
                  className="wk-mp-header__close"
                  onClick={onClose}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            /* 独立模式：状态pill + 日期 */
            <>
              <div className="wk-mp-header__row1">
                <StatusPicker
                  status={matter.status}
                  seqNo={matter.seq_no}
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
              </div>
            </>
          )}
        </header>

          {!showClose && (
            <EditableTitle
              value={matter.title}
              onSave={async (newTitle) => {
                const updated = await updateMatter(matter.id, { title: newTitle });
                applyMatterUpdate(updated);
              }}
            />
          )}

        {/* ── 主要目标 ── */}
        <div className="wk-mp-goal">
          <div className="wk-mp-goal__label">主要目标</div>
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
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path fillRule="evenodd" clipRule="evenodd" d="M14.0004 1.33301H8.94326C8.76645 1.33301 8.59688 1.40325 8.47185 1.52827L0.943259 9.05686C0.42256 9.57756 0.422559 10.4218 0.943258 10.9425L5.05764 15.0569C5.57834 15.5776 6.42256 15.5776 6.94326 15.0569L14.4719 7.52827C14.5969 7.40325 14.6671 7.23368 14.6671 7.05687V1.99967C14.6671 1.63148 14.3686 1.33301 14.0004 1.33301ZM10.3338 7.33301C11.2543 7.33301 12.0004 6.58682 12.0004 5.66634C12.0004 4.74587 11.2543 3.99967 10.3338 3.99967C9.41331 3.99967 8.66712 4.74587 8.66712 5.66634C8.66712 6.58682 9.41331 7.33301 10.3338 7.33301Z" fill="currentColor" />
              </svg>
              {myGroupsLoading ? (
                <span className="wk-mp-goal__source-skeleton" aria-label="加载中">
                  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </span>
              ) : isSourceMember ? (
                <span>来自 #{displaySourceName} · <UserName uid={matter.creator_id} /> · {formatSourceTime(matter.created_at)}</span>
              ) : (
                <span style={{ filter: "blur(2.5px)", opacity: 0.35, userSelect: "none" }}>来自 #████</span>
              )}
            </div>
          )}
          <EditableDescription
            value={matter.description || ""}
            onSave={async (newDesc) => {
              const updated = await updateMatter(matter.id, {
                description: newDesc || null,
              });
              applyMatterUpdate(updated);
            }}
          />
          {/* 创建人 / 负责人 */}
          <div className="wk-mp-people">
            <div className="wk-mp-people__item">
              <span className="wk-mp-people__role">创建人：</span>
              <span className="wk-mp-people__tag">
                <WKAvatar
                  channel={new Channel(matter.creator_id, ChannelTypePerson)}
                  style={{ width: 16, height: 16 }}
                />
                <UserName uid={matter.creator_id} className="wk-mp-people__name" />
              </span>
            </div>
            {assignees.length > 0 && (
              <div className="wk-mp-people__item">
                <span className="wk-mp-people__role">负责人：</span>
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
              </div>
            )}
          </div>
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
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path fillRule="evenodd" clipRule="evenodd" d="M8.00033 15.3332C12.0504 15.3332 15.3337 12.0499 15.3337 7.99984C15.3337 3.94975 12.0504 0.666504 8.00033 0.666504C3.95024 0.666504 0.666992 3.94975 0.666992 7.99984C0.666992 12.0499 3.95024 15.3332 8.00033 15.3332ZM12.6662 7.9184C12.6758 8.4706 12.236 8.92606 11.6838 8.9357L9.01751 8.98224L9.06405 11.6485C9.07369 12.2007 8.63386 12.6562 8.08166 12.6658C7.52945 12.6754 7.07399 12.2356 7.06435 11.6834L7.01781 9.01714L4.35155 9.06368C3.79935 9.07332 3.34389 8.63349 3.33425 8.08129C3.32462 7.52909 3.76445 7.07363 4.31665 7.06399L6.98291 7.01745L6.93637 4.35119C6.92673 3.79899 7.36657 3.34353 7.91877 3.33389C8.47097 3.32425 8.92643 3.76408 8.93607 4.31628L8.98261 6.98254L11.6489 6.936C12.2011 6.92637 12.6565 7.3662 12.6662 7.9184Z" fill="currentColor" />
                  </svg>
                  关联新会话
                </button>
              )}
            </div>
            {channels.length === 0 ? (
              <div className="wk-mp-channels__empty">暂无关联群聊或子区</div>
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
                  {/* 第一行：群名 + 同步时间 + 查看群聊 */}
                  <div className="wk-mp-channels__card-head">
                    <div className="wk-mp-channels__card-info">
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
                        {formatRelativeSyncTime(ch.created_at)}
                      </span>
                    </div>
                    {isMember && (
                      <ChannelMoreMenu
                        channelId={ch.channel_id}
                        channelType={ch.channel_type}
                        onUnlink={() => handleUnlinkChannel(ch.channel_id)}
                      />
                    )}
                  </div>

                  {/* 第二行：用户 + 时间 + ColorTag + 内容 */}
                  {isMember && latestByChannel.has(ch.channel_id) && (() => {
                    const latest = latestByChannel.get(ch.channel_id)!;
                    return (
                      <div className="wk-mp-channels__card-msg">
                        <div className="wk-mp-channels__card-msg-meta">
                          <span className="wk-mp-channels__card-msg-user">
                            <WKAvatar
                              channel={new Channel(latest.user_id, ChannelTypePerson)}
                              style={{ width: 20, height: 20 }}
                            />
                            <UserName uid={latest.user_id} className="wk-mp-channels__card-msg-name" />
                          </span>
                          <span className="wk-mp-channels__card-msg-time">
                            {new Date(latest.created_at).toLocaleString("zh-CN", {
                              month: "2-digit", day: "2-digit",
                              hour: "2-digit", minute: "2-digit",
                              hour12: false,
                            }).replace(/\//g, "-")}
                          </span>
                        </div>
                        <div className="wk-mp-channels__card-msg-content">
                          {latest.content || "（无文本内容）"}
                        </div>
                      </div>
                    );
                  })()}

                  {/* 展开/收起时间线按钮 */}
                  {isMember && (
                    <ChannelTimelineSection
                      ch={ch}
                      expanded={expandedTimelines.has(ch.channel_id)}
                      onToggle={() => toggleTimeline(ch.channel_id)}
                      chEntries={timeline.filter(
                        (e) =>
                          e.source_channel_id === ch.channel_id ||
                          (!e.source_channel_id && !e.channel_id),
                      )}
                      timelineLoading={timelineLoading}
                      onShowAnchor={(entry, ev, channelName) => {
                        const rect = ev.currentTarget.getBoundingClientRect();
                        setAnchor({
                          channelId: ch.channel_id,
                          channelType: ch.channel_type,
                          channelName,
                          messageIds: entry.source_msgs || [],
                          ...computeAnchorPosition(rect),
                        });
                      }}
                    />
                  )}
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
          top={anchor.top}
          bottom={anchor.bottom}
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
  seqNo,
  onChange,
  isCreator,
  canEditStatus,
}: {
  status: MatterStatus;
  seqNo?: number;
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
        {seqNo ? <span className="wk-mp-pill__no">｜M-{seqNo}</span> : null}
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
 *   - 垂直: 优先按钮下方 8px (top 锚点); 下方空间不足时贴按钮上方 (bottom 锚点)。
 *     上方用 bottom 锚点而非 top, 让弹框底边贴住按钮, 不依赖弹框实际高度
 *     (避免一两条消息时空隙过大、漂得太远的问题)。
 *
 * 返回: 始终带 x; 垂直方向二选一返回 top 或 bottom (viewport 像素)。
 * 调用方把 x/top/bottom 传进 AnchorPopover, 内部用 fixed 定位。
 */
function computeAnchorPosition(rect: DOMRect): {
  x: number;
  top?: number;
  bottom?: number;
} {
  const POP_WIDTH = 420;
  const POP_MIN_HEIGHT = 120; // 触发"向上展开"判定的最小预留高度
  const SAFE = 16;
  const GAP = 8; // 按钮与弹框的间距

  // 优先左对齐按钮，如果右侧空间不足则向左移动
  const x = Math.max(
    SAFE,
    Math.min(rect.left, window.innerWidth - POP_WIDTH - SAFE),
  );

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  // 下方足够 (至少能放最小高度): 用 top 锚点, 顶边贴按钮下方
  if (spaceBelow >= POP_MIN_HEIGHT + GAP) {
    return { x, top: rect.bottom + GAP };
  }
  // 否则上方展开: 用 bottom 锚点, 底边贴按钮上方
  // bottom = innerHeight - rect.top + GAP, 这样 popover 底边 = rect.top - GAP
  if (spaceAbove >= POP_MIN_HEIGHT + GAP) {
    return { x, bottom: window.innerHeight - rect.top + GAP };
  }
  // 极端情况 (按钮上下都没空间): 退化到 top 锚点 + SAFE 边距, 让 max-height 接管
  return { x, top: SAFE };
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

/** 格式化为相对时间："X分钟前同步" / "X小时前同步" / "X天前同步" */
function formatRelativeSyncTime(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = now - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚同步";
  if (minutes < 60) return `${minutes}分钟前同步`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前同步`;
  const days = Math.floor(hours / 24);
  return `${days}天前同步`;
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
        <span className="wk-mp-tl__title">群内时间线</span>
        <button
          type="button"
          className="wk-mp-tl__sort-btn"
          onClick={() => setSortNewest((v) => !v)}
          title="切换排序"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7.33333 10.667L4.66667 13.3337L2 10.667M4.66667 13.3337V2.66699" stroke="currentColor" strokeOpacity={sortNewest ? 1 : 0.4} strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.66602 5.33366L11.3327 2.66699L13.9993 5.33366M11.3327 2.66699V13.3337" stroke="currentColor" strokeOpacity={sortNewest ? 0.4 : 1} strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          时间排序
        </button>
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
                  <div className="wk-mp-tl__entry-main">
                    {/* 时间 */}
                    <span className="wk-mp-tl__time">
                      {formatTime(e.created_at)}
                    </span>
                    {/* 头像 + 人名 */}
                    <span className="wk-mp-tl__user">
                      <WKAvatar
                        channel={new Channel(e.user_id, ChannelTypePerson)}
                        style={{ width: 20, height: 20 }}
                      />
                      <UserName uid={e.user_id} className="wk-mp-tl__user-name" />
                    </span>
                    {/* 内容（前面带冒号） */}
                    <span className="wk-mp-tl__content-wrap">
                      <span className="wk-mp-tl__colon">：</span>
                      <span className="wk-mp-tl__content">{e.content || ""}</span>
                    </span>
                    {/* 附件 */}
                    {e.attachments && e.attachments.length > 0 && (
                      <span className="wk-mp-tl__att-count">
                        {e.attachments.length} 附件
                      </span>
                    )}
                  </div>
                  {/* 原消息按钮 */}
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
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path fillRule="evenodd" clipRule="evenodd" d="M14.333 1.66654L9.33318 1.66654L9.33318 2.99988L12.0564 2.99988L6.46884 8.58773L7.41167 9.53051L12.9996 3.9423L12.9995 6.66652L14.3328 6.66657L14.333 1.66654ZM7.33288 2.99984L2.99955 2.99984L2.99955 12.9998L12.9995 12.9998L12.9995 8.6665L14.3329 8.6665L14.3329 13.3332C14.3329 13.8855 13.8852 14.3332 13.3329 14.3332L2.66621 14.3332C2.11393 14.3332 1.66621 13.8855 1.66621 13.3332L1.66621 2.6665C1.66621 2.11422 2.11393 1.6665 2.66621 1.6665L7.33288 1.6665L7.33288 2.99984Z" fill="currentColor" />
                        </svg>
                        原消息
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
  // 子区 (channel_type=5): 额外反查父群名, 渲染成 "父群名/子区名"
  // 让用户在事项关联群聊里能看到子区的归属。
  // 父群号通过 toParentGroupNo 从子区 channel_id 拆出 (前半段)。
  const isThread = channelType === CHANNEL_TYPE_COMMUNITY_TOPIC;
  const parentGroupNo = isThread ? toParentGroupNo(channelId, channelType) : "";
  const parentLive = useChannelName(
    isThread ? parentGroupNo : null,
    isThread ? ChannelTypeGroup : null,
  );
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
  const selfName = live || fallback || channelId.slice(0, 8);
  // 父群名解析不出来时退化为只显示子区名, 不渲染孤零零的 "/"
  const display =
    isThread && parentLive ? `${parentLive}/${selfName}` : selfName;
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

// ─── ChannelTimelineSection (子组件: 展开/收起时间线 + 原消息按钮) ──
//
// 抽成子组件的原因: 需要在每个 channel card 里调 useChannelName hook
// 拿实时群名 (含子区), 但 hook 不能放 .map() 循环里。
// 子组件把 live name 传给 onShowAnchor callback, 解决子区群名无法渲染的问题。

function ChannelTimelineSection({
  ch,
  expanded,
  onToggle,
  chEntries,
  timelineLoading,
  onShowAnchor,
}: {
  ch: MatterChannelType;
  expanded: boolean;
  onToggle: () => void;
  chEntries: TimelineEntry[];
  timelineLoading: boolean;
  onShowAnchor: (entry: TimelineEntry, ev: React.MouseEvent, channelName: string) => void;
}) {
  // 实时解析 channel 名称 (群改名 / 子区标题都能跟上)
  const liveChannelName = useChannelName(ch.channel_id, ch.channel_type);
  const displayName = liveChannelName || ch.channel_name || ch.channel_id.slice(0, 8);

  return (
    <>
      <button
        type="button"
        className="wk-mp-channels__timeline-btn"
        onClick={onToggle}
      >
        {expanded ? "收起群内时间线" : "展开群内时间线"}
      </button>
      {expanded && (() => {
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
            canShowAnchor={() => true}
            onShowAnchor={(entry, ev) => {
              onShowAnchor(entry, ev, displayName);
            }}
          />
        );
      })()}
    </>
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
      return <span>初始 {(detail.summary as string) || "创建了事项"}</span>;
    case "title_changed":
      return (
        <span className="wk-mp-activity__diff-inline">
          <span className="wk-mp-activity__old">
            {(detail.from as string) || ""}
          </span>
          <ActivityArrowIcon />
          <span className="wk-mp-activity__new">
            {(detail.to as string) || ""}
          </span>
        </span>
      );
    case "description_changed": {
      // 设计稿样式：每行带 +/- 图标 + diff 内容
      // 后端 detail.summary 是文本摘要；如果有 added/removed 数组则按行渲染
      const added = (detail.added as string[]) || [];
      const removed = (detail.removed as string[]) || [];
      if (added.length === 0 && removed.length === 0) {
        return <span>{(detail.summary as string) || "更新了描述"}</span>;
      }
      return (
        <div className="wk-mp-activity__diff-list">
          {added.map((line, i) => (
            <div key={`add-${i}`} className="wk-mp-activity__diff-row wk-mp-activity__diff-row--add">
              <ActivityPlusIcon />
              <span className="wk-mp-activity__new">"{line}"</span>
            </div>
          ))}
          {removed.map((line, i) => (
            <div key={`rm-${i}`} className="wk-mp-activity__diff-row wk-mp-activity__diff-row--rm">
              <ActivityMinusIcon />
              <span className="wk-mp-activity__old">"{line}"</span>
            </div>
          ))}
        </div>
      );
    }
    case "deadline_changed": {
      const from = detail.from
        ? new Date((detail.from as number) * 1000).toLocaleDateString("zh-CN")
        : "无";
      const to = detail.to
        ? new Date((detail.to as number) * 1000).toLocaleDateString("zh-CN")
        : "无";
      return (
        <span className="wk-mp-activity__diff-inline">
          <span className="wk-mp-activity__old">{from}</span>
          <ActivityArrowIcon />
          <span className="wk-mp-activity__new">{to}</span>
        </span>
      );
    }
    case "status_changed":
      return (
        <span className="wk-mp-activity__diff-inline">
          <span className="wk-mp-activity__old">
            {(detail.from as string) || ""}
          </span>
          <ActivityArrowIcon />
          <span className="wk-mp-activity__new">
            {(detail.to as string) || ""}
          </span>
        </span>
      );
    case "assignee_added":
      return (
        <span>
          <UserName uid={(detail.user_id as string) || ""} />
        </span>
      );
    case "assignee_removed":
      return (
        <span>
          <UserName uid={(detail.user_id as string) || ""} />
        </span>
      );
    case "channel_linked":
      return (
        <span>
          #{(detail.channel_name as string) || (detail.channel_id as string) || ""}
        </span>
      );
    case "channel_unlinked":
      return (
        <span>
          #{(detail.channel_id as string) || ""}
        </span>
      );
    default:
      return <span>{activity.action}</span>;
  }
}

// ─── Activity 行内 SVG 图标 ──
function ActivityPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="wk-mp-activity__icon-add" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M8 14.667A6.667 6.667 0 108 1.333a6.667 6.667 0 000 13.334zm.667-9.334a.667.667 0 10-1.334 0v2H5.333a.667.667 0 100 1.334h2v2a.667.667 0 101.334 0v-2h2a.667.667 0 100-1.334h-2v-2z" fill="currentColor" />
    </svg>
  );
}

function ActivityMinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="wk-mp-activity__icon-rm" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M8 14.667A6.667 6.667 0 108 1.333a6.667 6.667 0 000 13.334zM5.333 7.333a.667.667 0 100 1.334h5.334a.667.667 0 100-1.334H5.333z" fill="currentColor" />
    </svg>
  );
}

function ActivityArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="wk-mp-activity__icon-arrow" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
      : filter === "channel_changed"
        ? activities.filter((a) => a.action === "channel_linked" || a.action === "channel_unlinked")
        : activities.filter((a) => a.action === filter);
  const sorted = [...filtered].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return sortNewest ? tb - ta : ta - tb;
  });

  const FILTER_OPTIONS = [
    { id: "all", label: "全部类型" },
    { id: "created", label: "创建" },
    { id: "description_changed", label: "目标变更" },
    { id: "deadline_changed", label: "DDL变更" },
    { id: "status_changed", label: "状态变更" },
    { id: "channel_changed", label: "关联群变更" },
  ];
  const currentFilter =
    FILTER_OPTIONS.find((o) => o.id === filter) || FILTER_OPTIONS[0];

  return (
    <div className="wk-mp-activity">
      {/* Toolbar: 类型筛选 + 时间排序 */}
      <div className="wk-mp-activity__toolbar">
        <span className="wk-mp-activity__filter-wrap" ref={filterRef}>
          <button
            type="button"
            className="wk-mp-activity__filter-btn"
            onClick={() => setFilterOpen((o) => !o)}
          >
            <span>变更类型：{currentFilter.label}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4.29 6.27L8 9.71l3.71-3.42" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
                  <span className="wk-mp-activity__filter-tick">
                    {o.id === filter && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </span>
        <button
          type="button"
          className="wk-mp-tl__sort-btn"
          onClick={() => setSortNewest((v) => !v)}
          title="切换排序"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M7.33333 10.667L4.66667 13.3337L2 10.667M4.66667 13.3337V2.66699" stroke="currentColor" strokeOpacity={sortNewest ? 1 : 0.4} strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.66602 5.33366L11.3327 2.66699L13.9993 5.33366M11.3327 2.66699V13.3337" stroke="currentColor" strokeOpacity={sortNewest ? 0.4 : 1} strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          时间排序
        </button>
      </div>

      {loading && <div className="wk-mp-empty-tab">加载中...</div>}
      {!loading && sorted.length === 0 && (
        <div className="wk-mp-empty-tab">暂无变更记录</div>
      )}
      {!loading && sorted.length > 0 && (
        <div className="wk-mp-activity__table-wrap">
          <table className="wk-mp-activity__table">
            <thead>
              <tr>
                <th className="wk-mp-activity__th wk-mp-activity__col-time">变更时间</th>
                <th className="wk-mp-activity__th wk-mp-activity__col-type">变更类型</th>
                <th className="wk-mp-activity__th wk-mp-activity__col-content">变更内容</th>
                <th className="wk-mp-activity__th wk-mp-activity__col-actor">变更人</th>
                <th className="wk-mp-activity__th wk-mp-activity__col-source">来源群</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id} className="wk-mp-activity__tr">
                  <td className="wk-mp-activity__td wk-mp-activity__col-time">
                    <span className="wk-mp-activity__time-text">
                      {formatActivityTime(a.created_at)}
                    </span>
                  </td>
                  <td className="wk-mp-activity__td wk-mp-activity__col-type">
                    {ACTION_LABELS[a.action] || a.action}
                  </td>
                  <td className="wk-mp-activity__td wk-mp-activity__col-content">
                    <ActivityContent activity={a} />
                  </td>
                  <td className="wk-mp-activity__td wk-mp-activity__col-actor">
                    <span className="wk-mp-activity__actor">
                      <WKAvatar
                        channel={new Channel(a.actor_id, ChannelTypePerson)}
                        style={{ width: 20, height: 20 }}
                      />
                      <UserName uid={a.actor_id} />
                    </span>
                  </td>
                  <td className="wk-mp-activity__td wk-mp-activity__col-source">
                    <span className="wk-mp-activity__td-empty">-</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  prefix,
  inline,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  /** 显示在标题前的前缀文字（如 "M-123｜"），不参与编辑 */
  prefix?: string;
  /** 内联模式：用 span 而非 h1，字号更小 */
  inline?: boolean;
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
      <div ref={containerRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, flex: inline ? 1 : undefined, minWidth: 0 }}>
        {prefix && <span className="wk-mp-header__inline-prefix">{prefix}</span>}
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

  if (inline) {
    return (
      <span
        className="wk-mp-header__inline-title"
        onClick={() => setEditing(true)}
        title="点击编辑标题"
      >
        {prefix}{value}
      </span>
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
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${d.getMonth() + 1}/${d.getDate()} ${weekdays[d.getDay()]}`;
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
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
            >
              <path d="M5.33 1.33v2M10.67 1.33v2M2 6h12M3.33 3.33h9.34a1.33 1.33 0 011.33 1.34v8a1.33 1.33 0 01-1.33 1.33H3.33A1.33 1.33 0 012 12.67v-8a1.33 1.33 0 011.33-1.34z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="wk-mp-header__ddl-value">
              {display ? `截止到 ${display}` : "设置截止日期"}
            </span>
          </span>
        )}
      />
    </span>
  );
}
