import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Spin,
  Toast,
  Select,
  Pagination,
  DatePicker,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon, ClipboardList, ArrowUp, ArrowDown } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Issue, IssueStatus, IssuePriority, IssueSortField, IssueDateField } from "../api/types";
import { ISSUE_SORT_FIELDS, ISSUE_DATE_FIELDS } from "../api/types";
import { listIssues } from "../api/issueApi";
import { listProjectOptions } from "../api/directory";
import { useAssigneeCandidates } from "../ui/useAssigneeCandidates";
import { ISSUE_STATUS_ORDER, PRIORITY_ORDER } from "../ui/meta";
import IssueBoard from "../panel/IssueBoard";
import IssueList from "../panel/IssueList";
import IssueDetailPage from "../panel/IssueDetailPage";
import CreateIssueModal from "../ui/CreateIssueModal";

const { Title } = Typography;

type ViewMode = "board" | "list";

interface Filters {
  keyword: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  assignee?: string;
  creator?: string;
  project?: string;
  dateField: IssueDateField; // 时间范围筛选的列(created_at|updated_at)
  dateRange?: Date[];        // [start, end];为空则不按时间筛选
  sortBy: IssueSortField;
  sortDir: "asc" | "desc";
}

const PAGE_SIZE = 50;

export default function IssuePage() {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("board");
  const [f, setF] = useState<Filters>({ keyword: "", sortBy: "position", sortDir: "desc", dateField: "created_at" });
  const [page, setPage] = useState(0); // 0-based，仅列表视图分页
  const [createOpen, setCreateOpen] = useState(false);
  const cands = useAssigneeCandidates();
  // 项目下拉复用 directory 已缓存的 /projects(避免重复请求);随 workspace 切换整页重挂而刷新。
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const seq = useRef(0); // 请求序号：只应用最新一次的响应，防并发乱序覆盖

  useEffect(() => {
    listProjectOptions().then(setProjects).catch(() => {});
  }, []);

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    const paged = view === "list";
    // 时间范围:三参数须同时给且 start<end。onChange 已把 dateRange 归一为 undefined|[起,止]。
    // 止端 +1 日历日 → 半开区间,既含止日当天、又保证 start<end(即使起止同一天);setDate 处理 DST。
    const dr = f.dateRange;
    const endExclusive = dr && new Date(dr[1]);
    if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1);
    listIssues({
      keyword: f.keyword,
      status: f.status,
      priority: f.priority,
      assignee_id: f.assignee,
      creator_id: f.creator,
      project_id: f.project,
      date_field: dr ? f.dateField : undefined,
      date_start: dr ? dr[0].toISOString() : undefined,
      date_end: endExclusive ? endExclusive.toISOString() : undefined,
      // 排序仅用于列表视图;看板按 status 分列 + 100 上限,叠加全局排序会把某状态整列截没,故看板固定后端默认(position)。
      sort_by: paged ? f.sortBy : undefined,
      sort_direction: paged ? f.sortDir : undefined,
      // ponytail: 看板不分页——按 status 分列需全量，取后端上限 100；超量请用筛选或列表视图。
      limit: paged ? PAGE_SIZE : 100,
      offset: paged ? page * PAGE_SIZE : 0,
    })
      .then(({ issues, total }) => {
        if (my !== seq.current) return; // 有更新的请求在途，丢弃本次过期响应
        // 删除/改状态使匹配数下降时，当前 page 可能越界（offset≥total）→ 钳到最后一页并重取。
        if (paged) {
          const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
          if (page > maxPage) { setPage(maxPage); return; }
        }
        setIssues(issues);
        setTotal(total);
      })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [f, view, page]);

  useEffect(reload, [reload]);

  // 改任一筛选/搜索都回到第一页，避免停在越界的 offset（此规则只此一处表达）。
  const update = (p: Partial<Filters>) => { setF((prev) => ({ ...prev, ...p })); setPage(0); };
  const switchView = (v: ViewMode) => { setView(v); setPage(0); };

  // 点击 Issue → 跳转独立详情页（push 到右主栏，返回可 pop）。
  const openDetail = (id: string) => {
    WKApp.routeRight.push(<IssueDetailPage issueId={id} onChanged={reload} />);
  };

  return (
    <div className="loop-page">
      <div className="loop-page__head">
        <Title heading={4}>{t("loop.nav.issue")}</Title>
        <div className="loop-viewtoggle">
          <button className={view === "board" ? "is-active" : ""} onClick={() => switchView("board")}>
            <LayoutGrid size={14} />
            {t("loop.view.board")}
          </button>
          <button className={view === "list" ? "is-active" : ""} onClick={() => switchView("list")}>
            <ListIcon size={14} />
            {t("loop.view.list")}
          </button>
        </div>
        <div className="loop-page__spacer" />
        <Select
          placeholder={t("loop.filter.status")}
          value={f.status}
          onChange={(v) => update({ status: v as IssueStatus | undefined })}
          showClear
          size="small"
          style={{ width: 130 }}
        >
          {ISSUE_STATUS_ORDER.map((s) => (
            <Select.Option key={s} value={s}>{t(`loop.status.${s}`)}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder={t("loop.filter.priority")}
          value={f.priority}
          onChange={(v) => update({ priority: v as IssuePriority | undefined })}
          showClear
          size="small"
          style={{ width: 120 }}
        >
          {PRIORITY_ORDER.map((p) => (
            <Select.Option key={p} value={p}>{t(`loop.priority.${p}`)}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder={t("loop.filter.assignee")}
          value={f.assignee}
          onChange={(v) => update({ assignee: v as string | undefined })}
          showClear
          filter
          size="small"
          style={{ width: 150 }}
        >
          {cands.map((c) => (
            <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
          ))}
        </Select>
        <Select
          placeholder={t("loop.filter.creator")}
          value={f.creator}
          onChange={(v) => update({ creator: v as string | undefined })}
          showClear
          filter
          size="small"
          style={{ width: 130 }}
        >
          {cands.filter((c) => c.type === "member").map((c) => (
            <Select.Option key={c.id} value={c.id}>{c.name}</Select.Option>
          ))}
        </Select>
        {projects.length > 0 && (
          <Select
            placeholder={t("loop.filter.project")}
            value={f.project}
            onChange={(v) => update({ project: v as string | undefined })}
            showClear
            filter
            size="small"
            style={{ width: 140 }}
          >
            {projects.map((p) => (
              <Select.Option key={p.id} value={p.id}>{p.title}</Select.Option>
            ))}
          </Select>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {f.dateRange && (
            <Select
              value={f.dateField}
              onChange={(v) => update({ dateField: v as IssueDateField })}
              size="small"
              style={{ width: 104 }}
            >
              {ISSUE_DATE_FIELDS.map((d) => (
                <Select.Option key={d} value={d}>{t(`loop.dateField.${d}`)}</Select.Option>
              ))}
            </Select>
          )}
          <DatePicker
            type="dateRange"
            size="small"
            density="compact"
            value={f.dateRange}
            onChange={(d) => update({ dateRange: Array.isArray(d) && d.length === 2 && d[0] && d[1] ? (d as Date[]) : undefined })}
            placeholder={t("loop.filter.dateRange")}
            style={{ width: 220 }}
          />
        </div>
        {view === "list" && (
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Select
            value={f.sortBy}
            onChange={(v) => update({ sortBy: v as IssueSortField })}
            size="small"
            style={{ width: 120 }}
          >
            {ISSUE_SORT_FIELDS.map((s) => (
              <Select.Option key={s} value={s}>{t(`loop.sort.${s}`)}</Select.Option>
            ))}
          </Select>
          <Button
            size="small"
            theme="borderless"
            // position(手动序)后端忽略方向,禁用切换。
            disabled={f.sortBy === "position"}
            icon={f.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            aria-label={t("loop.sort.direction")}
            onClick={() => update({ sortDir: f.sortDir === "asc" ? "desc" : "asc" })}
          />
        </div>
        )}
        <Input
          prefix={<Search size={14} />}
          placeholder={t("loop.search.issue")}
          value={f.keyword}
          onChange={(v) => update({ keyword: v })}
          showClear
          style={{ width: 200 }}
        />
        <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
          {t("loop.action.newIssue")}
        </Button>
      </div>

      <div className="loop-page__body">
        {loading ? (
          <div className="loop-page__center">
            <Spin />
          </div>
        ) : total === 0 ? (
          <div className="loop-empty">
            <ClipboardList size={40} className="loop-empty__icon" />
            <div className="loop-empty__title">{t("loop.empty.issueTitle")}</div>
            <div className="loop-empty__desc">{t("loop.empty.issueDesc")}</div>
            <Button theme="solid" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)} style={{ marginTop: 12 }}>
              {t("loop.action.newIssue")}
            </Button>
          </div>
        ) : view === "board" ? (
          <IssueBoard issues={issues} onOpen={openDetail} onChanged={reload} />
        ) : (
          <>
            <IssueList issues={issues} onOpen={openDetail} onChanged={reload} />
            {total > PAGE_SIZE && (
              <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 4px" }}>
                <Pagination
                  total={total}
                  pageSize={PAGE_SIZE}
                  currentPage={page + 1}
                  onPageChange={(p) => setPage(p - 1)}
                />
              </div>
            )}
          </>
        )}
      </div>

      <CreateIssueModal
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { Toast.success(t("loop.toast.created")); reload(); }}
      />
    </div>
  );
}
