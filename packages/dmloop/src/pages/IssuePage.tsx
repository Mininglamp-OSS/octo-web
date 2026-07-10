import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Typography,
  Input,
  Button,
  Spin,
  Toast,
  Select,
  Pagination,
} from "@douyinfe/semi-ui";
import { Search, Plus, LayoutGrid, List as ListIcon, ClipboardList } from "lucide-react";
import { useI18n, WKApp } from "@octo/base";
import type { Issue, IssueStatus, IssuePriority } from "../api/types";
import { listIssues } from "../api/issueApi";
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
}

const PAGE_SIZE = 50;

export default function IssuePage() {
  const { t } = useI18n();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("board");
  const [f, setF] = useState<Filters>({ keyword: "" });
  const [page, setPage] = useState(0); // 0-based，仅列表视图分页
  const [createOpen, setCreateOpen] = useState(false);
  const cands = useAssigneeCandidates();
  const seq = useRef(0); // 请求序号：只应用最新一次的响应，防并发乱序覆盖

  const reload = useCallback(() => {
    const my = ++seq.current;
    setLoading(true);
    const paged = view === "list";
    listIssues({
      keyword: f.keyword,
      status: f.status,
      priority: f.priority,
      assignee_id: f.assignee,
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
